function createDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'promo-dialog';
  dialog.setAttribute('aria-labelledby', 'promoTitle');
  dialog.innerHTML = `
    <form method="dialog"><button class="dialog-close" aria-label="Đóng ưu đãi">×</button></form>
    <div class="promo-content">
      <p class="eyebrow">ƯU ĐÃI DÀNH CHO BẠN</p>
      <p class="promo-badge"></p>
      <h2 id="promoTitle"></h2>
      <p class="promo-description"></p>
      <p class="promo-expiry"></p>
      <button class="button coral promo-claim" type="button">Nhận tư vấn ưu đãi</button>
      <small>Ưu đãi áp dụng theo điều kiện thực tế của tour; nhân viên sẽ xác nhận khi tư vấn.</small>
    </div>`;
  document.body.append(dialog);
  return dialog;
}

export function showPromotion(temperature, onClaim) {
  if (!['HOT', 'WARM'].includes(temperature)) return;

  let shown = '';
  try {
    shown = sessionStorage.getItem('vietjourney_promo_shown') || '';
  } catch (error) {
    console.error('[promo-offers] Could not read promotion state', error);
  }
  if (shown === 'HOT' || (shown === 'WARM' && temperature !== 'HOT')) return;

  const dialog = document.querySelector('.promo-dialog') || createDialog();
  const hot = temperature === 'HOT';
  dialog.dataset.voucherCode = hot ? 'BUFFET5STAR' : 'NOV20';
  dialog.querySelector('.promo-badge').textContent = hot
    ? 'ƯU ĐÃI HOT · CHỈ HÔM NAY'
    : 'ƯU ĐÃI THÁNG 11';
  dialog.querySelector('#promoTitle').textContent = hot
    ? 'Tặng vé buffet khách sạn 5 sao'
    : 'Giảm 20% khi đặt tour trong tháng 11';
  dialog.querySelector('.promo-description').textContent = hot
    ? 'Bạn đang quan tâm đến hành trình này. Để lại số điện thoại để đội ngũ tư vấn điều kiện nhận ưu đãi buffet khi đặt tour.'
    : 'Bạn có thể nhận ưu đãi giảm 20% khi đặt tour. Gửi thông tin để đội ngũ tư vấn kiểm tra tour áp dụng và điều kiện cụ thể.';
  dialog.querySelector('.promo-expiry').textContent = hot
    ? `Ưu đãi được giới thiệu đến 23:59 hôm nay (${new Intl.DateTimeFormat('vi-VN').format(new Date())}).`
    : 'Ưu đãi tháng 11 · áp dụng theo điều kiện của từng tour.';

  try {
    sessionStorage.setItem('vietjourney_promo_shown', temperature);
  } catch (error) {
    console.error('[promo-offers] Could not save promotion state', error);
  }

  const claim = dialog.querySelector('.promo-claim');
  claim.onclick = () => {
    dialog.close();
    onClaim(dialog.dataset.voucherCode);
  };
  if (!dialog.open) dialog.showModal();
}
