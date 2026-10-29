// Set your public contact address here
const CONTACT_EMAIL = "electronlearners@gmail.com";

const menu = document.querySelector('.menu'), list = document.querySelector('nav ul');
if (menu && list) {
  const setOpen = open => {
    list.classList.toggle('open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  menu.addEventListener('click', () => setOpen(!list.classList.contains('open')));
  list.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && list.classList.contains('open')) { setOpen(false); menu.focus(); } });
}

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab,.panel').forEach(e => e.classList.remove('on'));
  t.classList.add('on');
  document.getElementById(t.dataset.p).classList.add('on');
}));

const yr = document.getElementById('year');
if (yr) yr.textContent = new Date().getFullYear();
const mail = document.getElementById('mail');
if (mail) { mail.textContent = CONTACT_EMAIL; mail.href = 'mailto:' + CONTACT_EMAIL; }

// Static site, no backend: the form opens the visitor's mail client
const cf = document.getElementById('cf');
if (cf) cf.addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = `Name: ${f.get('name')}\nEmail: ${f.get('email')}\nTopic: ${f.get('topic')}\n\n${f.get('msg')}`;
  location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('VIN Technologies enquiry - ' + f.get('topic'))}&body=${encodeURIComponent(body)}`;
});
