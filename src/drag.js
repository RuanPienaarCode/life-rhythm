'use strict';
/* Pointer drag for the plan board — one code path for touch and mouse
   (PointerEvent is Safari 13+, comfortably under the iOS 15 floor).

   The card itself never moves: a clone floats under the finger, so the
   column never reflows mid-drag and the drop target stays where the eye
   left it. Only the grip carries `touch-action: none`, so the board still
   scrolls when you drag anywhere else on a card. */

const THRESHOLD = 6; // px before a press becomes a drag, so taps still tap

function draggable(grip, o) {
  let startX = 0, startY = 0, ghost = null, over = null, active = false, pid = null;

  const findDrop = (x, y) => {
    /* elementFromPoint would hit the ghost itself — hide it for the probe. */
    const vis = ghost.style.visibility;
    ghost.style.visibility = 'hidden';
    const under = document.elementFromPoint(x, y);
    ghost.style.visibility = vis;
    return under && under.closest ? under.closest(o.dropSelector) : null;
  };

  const begin = () => {
    active = true;
    const card = o.card;
    const r = card.getBoundingClientRect();
    ghost = card.cloneNode(true);
    ghost.classList.add('rv-ghost');
    ghost.style.width = `${r.width}px`;
    ghost.style.left = `${r.left}px`;
    ghost.style.top = `${r.top}px`;
    document.body.appendChild(ghost);
    card.classList.add('is-dragging');
    if (o.onStart) o.onStart();
  };

  const clear = () => {
    if (over) { over.classList.remove('is-over'); over = null; }
    if (ghost) { ghost.remove(); ghost = null; }
    o.card.classList.remove('is-dragging');
    if (active && o.onEnd) o.onEnd();
    active = false;
  };

  const onMove = e => {
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!active) {
      if (Math.abs(dx) + Math.abs(dy) < THRESHOLD) return;
      begin();
    }
    if (e.cancelable) e.preventDefault();
    const tilt = Math.max(-5, Math.min(5, dx / 18));
    ghost.style.transform = `translate(${dx}px, ${dy}px) rotate(${tilt}deg)`;
    const drop = findDrop(e.clientX, e.clientY);
    if (drop !== over) {
      if (over) over.classList.remove('is-over');
      over = drop;
      if (over) over.classList.add('is-over');
    }
  };

  const onUp = e => {
    detach();
    if (!active) return;
    const target = over;
    clear();
    if (target && o.onDrop) o.onDrop(target);
  };

  const onCancel = () => { detach(); clear(); };

  function detach() {
    grip.removeEventListener('pointermove', onMove);
    grip.removeEventListener('pointerup', onUp);
    grip.removeEventListener('pointercancel', onCancel);
    if (pid !== null && grip.releasePointerCapture) {
      try { grip.releasePointerCapture(pid); } catch (err) { /* already gone */ }
    }
    pid = null;
  }

  grip.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    startX = e.clientX; startY = e.clientY;
    pid = e.pointerId;
    /* Capture on the grip so a fast drag that outruns the finger still
       delivers its move and up events here. */
    if (grip.setPointerCapture) { try { grip.setPointerCapture(pid); } catch (err) { /* not captured */ } }
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onCancel);
  });
}

module.exports = { draggable };
