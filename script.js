// Set your public contact address here
const CONTACT_EMAIL = "contact@example.com";

const menu = document.querySelector('.menu'), list = document.querySelector('nav ul');
menu.addEventListener('click', () => list.classList.toggle('open'));
list.querySelectorAll('a').forEach(a => a.addEventListener('click', () => list.classList.remove('open')));

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab,.panel').forEach(e => e.classList.remove('on'));
  t.classList.add('on');
  document.getElementById(t.dataset.p).classList.add('on');
}));

document.getElementById('year').textContent = new Date().getFullYear();
const mail = document.getElementById('mail');
mail.textContent = CONTACT_EMAIL;
mail.href = 'mailto:' + CONTACT_EMAIL;

// Static site, no backend: the form opens the visitor's mail client
document.getElementById('cf').addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = `Name: ${f.get('name')}\nEmail: ${f.get('email')}\nTopic: ${f.get('topic')}\n\n${f.get('msg')}`;
  location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('VIN Technologies enquiry - ' + f.get('topic'))}&body=${encodeURIComponent(body)}`;
});
