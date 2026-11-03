// Single source of KPI logic. Used by dashboard.js and tests.
// Mirrors the formulas in the Excel simulation (Funnel Data / KPI Calculation sheets).

export const SCENARIO_ORDER = ['base', 'good', 'weak'];

export function computeScenario(inputs) {
  const visitors = inputs.visitors_per_month;
  const leads = visitors * inputs.lead_rate;
  const mql = leads * inputs.mql_rate;
  const sql = mql * inputs.sql_rate;
  const customers = sql * inputs.customer_rate;
  const revenue = customers * inputs.avg_booking_value;
  const spend = inputs.marketing_spend_per_month;
  const cac = customers > 0 ? spend / customers : 0;
  const ltv = inputs.avg_booking_value * inputs.purchases_per_customer;

  return {
    visitors,
    leads,
    mql,
    sql,
    customers,
    revenue,
    spend,
    cac,
    ltv,
    ltvToCac: cac > 0 ? ltv / cac : 0,
    contribution: revenue - spend,
    leadRate: visitors ? leads / visitors : 0,
    qualificationRate: leads ? mql / leads : 0,
    sqlRate: mql ? sql / mql : 0,
    customerPerLead: leads ? customers / leads : 0,
    visitorToCustomer: visitors ? customers / visitors : 0,
  };
}

export function projectTrend(inputs, months = 6) {
  return Array.from({ length: months }, (_, index) => ({
    month: index + 1,
    ...computeScenario({
      ...inputs,
      visitors_per_month: inputs.visitors_per_month * (1 + inputs.monthly_growth) ** index,
    }),
  }));
}
