document.addEventListener('DOMContentLoaded', () => {
  const eggForm = document.getElementById('eggForm');
  const openBtn = document.getElementById('openEggBtn');
  const resultDiv = document.getElementById('result');
  const raritySelect = document.getElementById('raritySelect');

  function randomizeBtn() {
    openBtn.style.position = "relative";
    openBtn.style.left = (Math.random() * 30 - 15) + "px";
    openBtn.style.top = (Math.random() * 12 - 6) + "px";
  }
  randomizeBtn();

  eggForm.onsubmit = async (e) => {
    e.preventDefault();
    openBtn.disabled = true;
    resultDiv.innerHTML = `<div class="egg-anim"></div><div class="opening-msg">Ei wird geöffnet...</div>`;
    setTimeout(async () => {
      const rarity = raritySelect.value;
      fetch('/api/open-egg', {
        method: 'POST',
        headers: {'Content-Type':'application/x-www-form-urlencoded'},
        body: 'rarity='+encodeURIComponent(rarity)
      })
        .then(r => r.json())
        .then(data => showEggResult(data, rarity));
    }, 800);
  };

  function showEggResult(data, rarity) {
    if (data.error) {
      resultDiv.innerHTML = `<div class="error">${data.error}</div>`;
      openBtn.disabled = false;
      randomizeBtn();
      return;
    }
    let typenIcons = data.typen.split(',').map(t =>
      `<span class="type type-${t}">${t}</span>`
    ).join(' ');
    resultDiv.innerHTML = `
      <div class="card ${rarity} reveal">
        <img src="${data.img}" style="max-width:120px"/><br/>
        <b>${data.display_name}</b> <small>(${data.name})</small>
        <div>Rarität: <span class="${rarity}">${rarity}</span> ${data.shiny ? '✨' : ''}</div>
        <div>Typ: ${typenIcons}</div>
        <div>Generation: ${data.gen}</div>
        <div>XP erhalten: +${data.xpAdd}</div>
        <a href="/inventory">Zum Inventar</a>
      </div>
      <button id="nextEggBtn" class="nextegg">Nächstes Ei öffnen</button>
    `;
    document.getElementById('nextEggBtn').onclick = () => {
      resultDiv.innerHTML = "";
      openBtn.disabled = false;
      randomizeBtn();
    };
  }
});