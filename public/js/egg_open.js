document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('openEggBtn');
  if (!btn) return;
  btn.addEventListener('click', async function() {
    btn.disabled = true;
    const eggAnim = document.getElementById('egg-anim');
    eggAnim.classList.add('opening');
    await new Promise(r=>setTimeout(r, 2000));
    fetch('/api/open-egg', { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.error) return document.getElementById('result').innerText = data.error;
        let stars = data.shiny ? ' ✨✨✨' : '';
        document.getElementById('result').innerHTML = `
          <div class="card ${data.rarity.key}">
            <img src="${data.img}" style="max-width:120px"/><br/>
            <b>${data.name.charAt(0).toUpperCase() + data.name.slice(1)}</b> <span class="${data.rarity.key}">${data.rarity.label}</span>${stars}
            <div>Wert: ${data.shiny ? data.rarity.value*10 : data.rarity.value}</div>
            <div>${data.shiny ? '<div class="shiny">Shiny!!</div>' : ''}</div>
            <a href="/inventory">Zum Inventar</a>
          </div>
        `;
        eggAnim.style.display = "none";
        btn.style.display = "none";
      });
  });
});