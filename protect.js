/* Print / save / copy deterrents. These raise the effort needed; they cannot make a public web page unsavable
   (screenshots, view-source and downloaders always exist). Interactive simulators under /lab/ keep their own
   shortcuts and context menus; only printing is blocked there. */
(function(){
  var root=document.documentElement;
  var inApp=location.pathname.indexOf('/lab/')===0;
  var noop=function(){};
  try{window.print=noop}catch(e){}
  // Hide everything while a print or "save as PDF" snapshot is taken
  window.addEventListener('beforeprint',function(){root.style.setProperty('display','none','important')});
  window.addEventListener('afterprint',function(){root.style.removeProperty('display')});
  if(inApp) return;
  root.classList.add('nocopy');
  function editable(t){return t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable)}
  // Ctrl/Cmd + P (print), S (save), U (view source), and Ctrl+Shift+S
  window.addEventListener('keydown',function(e){
    var k=(e.key||'').toLowerCase();
    if((e.ctrlKey||e.metaKey)&&(k==='p'||k==='s'||k==='u')){e.preventDefault();e.stopPropagation();return false}
  },true);
  document.addEventListener('contextmenu',function(e){if(!editable(e.target))e.preventDefault()});
  document.addEventListener('dragstart',function(e){e.preventDefault()});
  ['copy','cut'].forEach(function(n){document.addEventListener(n,function(e){if(!editable(e.target)){e.preventDefault();if(e.clipboardData)e.clipboardData.setData('text/plain','')}})});
  document.addEventListener('selectstart',function(e){if(!editable(e.target)&&!(e.target.closest&&e.target.closest('#contact')))e.preventDefault()});
})();
