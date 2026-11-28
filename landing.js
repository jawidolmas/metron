// Landing page: unlocks page scrolling while it is visible, reveals sections on scroll,
// and lets the extra sign-in buttons use the main Google button.
(() => {
  const auth = document.querySelector('#auth');
  if (!auth) return;
  const root = document.documentElement;

  // The desktop app layout locks the page height. The landing page needs normal scrolling.
  const sync = () => root.classList.toggle('on-landing', !auth.hidden);
  new MutationObserver(sync).observe(auth, { attributes: true, attributeFilter: ['hidden'] });
  sync();

  document.querySelectorAll('[data-signin]').forEach(b => b.addEventListener('click', () => {
    const g = document.querySelector('#google');
    if (g) g.click();
  }));

  const items = auth.querySelectorAll('.rv');
  if (!('IntersectionObserver' in window)) return;
  root.classList.add('js-on');
  const show = e => e.classList.add('in');
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
  }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  items.forEach(i => io.observe(i));
})();