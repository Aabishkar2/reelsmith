// Tutorial player: opens a tutorial card in a modal <video> instead of following its link.
// Without JS the cards still link straight to the MP4. #tut-03 in the URL opens episode 3.
(() => {
  const REPO = 'https://github.com/Aabishkar2/reelsmith/tree/main/videos/';
  const cards = [...document.querySelectorAll('.tut')];
  const dialog = document.getElementById('player');
  if (!cards.length || !dialog || typeof dialog.showModal !== 'function') return;

  const $ = (id) => document.getElementById(id);
  const video = $('player-video');
  const nextUp = $('player-next-up');
  let current = -1;

  function show(i) {
    const card = cards[i];
    current = i;
    $('player-ep').textContent = `Episode ${i + 1} of ${cards.length}`;
    $('player-title').textContent = card.querySelector('h3').textContent;
    $('player-desc').textContent = card.querySelector('p').textContent;
    $('player-src').href = REPO + card.dataset.folder;
    $('player-prev').disabled = i === 0;
    $('player-next').disabled = i === cards.length - 1;
    nextUp.hidden = true;
    const img = card.querySelector('img');
    video.poster = img ? img.src : '';
    video.src = card.getAttribute('href');
    video.play().catch(() => {}); // autoplay can be refused; the controls are there
    history.replaceState(null, '', '#' + card.id);
  }

  function open(i) {
    if (!dialog.open) dialog.showModal();
    show(i);
  }

  dialog.addEventListener('close', () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (current >= 0) {
      history.replaceState(null, '', location.pathname + location.search);
      cards[current].focus();
    }
    current = -1;
  });

  cards.forEach((card, i) => card.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let "open in new tab" work
    e.preventDefault();
    open(i);
  }));

  $('player-close').addEventListener('click', () => dialog.close());
  $('player-prev').addEventListener('click', () => current > 0 && show(current - 1));
  $('player-next').addEventListener('click', () => current < cards.length - 1 && show(current + 1));
  nextUp.addEventListener('click', () => show(current + 1));

  // A click on the backdrop (the dialog element itself, outside .player-inner) closes it.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  dialog.addEventListener('keydown', (e) => {
    if (e.target.closest('button, a, video')) return; // focused controls and the video keep their own arrow keys
    if (e.key === 'ArrowRight' && current < cards.length - 1) { e.preventDefault(); show(current + 1); }
    if (e.key === 'ArrowLeft' && current > 0) { e.preventDefault(); show(current - 1); }
  });

  video.addEventListener('ended', () => {
    if (current < cards.length - 1) {
      nextUp.textContent = `Up next: ${cards[current + 1].querySelector('h3').textContent} ▶`;
      nextUp.hidden = false;
    }
  });
  video.addEventListener('play', () => { nextUp.hidden = true; });

  const fromHash = cards.findIndex((c) => '#' + c.id === location.hash);
  if (fromHash >= 0) open(fromHash);
})();
