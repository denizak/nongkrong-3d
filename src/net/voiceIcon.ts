import '../ui/voice.css';

/** A small cream pill with three bars that move: the "this player is talking" mark. Hidden until placed. */
export function voiceIcon(extraClass = 'voice-icon'): HTMLDivElement {
  const el = document.createElement('div');
  el.className = extraClass;
  el.style.visibility = 'hidden';
  el.setAttribute('aria-hidden', 'true');
  const wave = document.createElement('span');
  wave.className = 'voice-wave';
  for (let i = 0; i < 3; i++) wave.append(document.createElement('span'));
  el.append(wave);
  document.body.append(el);
  return el;
}
