import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computeScenario, projectTrend } from '../kpi-model.js';

const assumptions = JSON.parse(await readFile(new URL('../data/kpi-assumptions.json', import.meta.url), 'utf8'));

test('base scenario reproduces the documented funnel and CAC', () => {
  const base = computeScenario(assumptions.scenarios.base);
  assert.equal(base.leads, 300);
  assert.equal(base.mql, 120);
  assert.equal(base.sql, 60);
  assert.equal(base.customers, 15);
  assert.equal(base.revenue, 87_525_000);
  assert.equal(Math.round(base.cac), 1_333_333);
  assert.equal(base.ltv, 7_293_750);
});

test('funnel never grows downstream of leads (customers <= leads)', () => {
  for (const key of Object.keys(assumptions.scenarios)) {
    const s = computeScenario(assumptions.scenarios[key]);
    assert.ok(s.customers <= s.leads, `${key}: customers must not exceed leads`);
    assert.ok(s.mql <= s.leads && s.sql <= s.mql, `${key}: stages must narrow`);
  }
});

test('changing a funnel assumption moves customers and revenue in proportion', () => {
  const base = assumptions.scenarios.base;
  const higher = computeScenario({ ...base, lead_rate: base.lead_rate * 2 });
  const lower = computeScenario(base);
  assert.equal(Math.round(higher.customers / lower.customers * 100) / 100, 2);
  assert.equal(Math.round(higher.revenue / lower.revenue * 100) / 100, 2);
});

test('scenario order is good > base > weak on customers and CAC', () => {
  const good = computeScenario(assumptions.scenarios.good);
  const base = computeScenario(assumptions.scenarios.base);
  const weak = computeScenario(assumptions.scenarios.weak);
  assert.ok(good.customers > base.customers && base.customers > weak.customers);
  assert.ok(good.cac < base.cac && base.cac < weak.cac);
});

test('trend projects six months with compounding visitor growth and fixed spend', () => {
  const trend = projectTrend(assumptions.scenarios.base);
  assert.equal(trend.length, 6);
  assert.equal(trend[0].visitors, 10000);
  assert.ok(Math.abs(trend[1].visitors - 10500) < 1e-6);
  assert.ok(trend.every((row) => row.spend === 20_000_000));
});
