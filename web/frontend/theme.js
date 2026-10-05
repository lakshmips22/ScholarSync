(function(){
  "use strict";
  const key="scholarsyncTheme";
  const stored=localStorage.getItem(key);
  const initial=stored==="dark"||stored==="light"?stored:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");
  const root=document.documentElement;
  function apply(theme){
    root.dataset.theme=theme;
    root.style.colorScheme=theme;
    localStorage.setItem(key,theme);
    const button=document.getElementById("themeToggle");
    if(button){button.textContent=theme==="dark"?"☀ Light mode":"☾ Dark mode";button.setAttribute("aria-label",theme==="dark"?"Switch to light mode":"Switch to dark mode");button.setAttribute("aria-pressed",String(theme==="dark"));button.title=theme==="dark"?"Switch to light mode":"Switch to dark mode";button.dataset.themeState=theme;}
  }
  apply(initial);
  document.addEventListener("DOMContentLoaded",function(){
    let host=document.querySelector("#publicNavigation, .toplinks, .top-actions, header.topbar");
    if(!host)return;
    const button=document.createElement("button");button.type="button";button.id="themeToggle";button.className="theme-toggle";button.setAttribute("aria-pressed",String(root.dataset.theme==="dark"));button.addEventListener("click",function(){apply(root.dataset.theme==="dark"?"light":"dark");});
    host.appendChild(button);apply(root.dataset.theme||initial);
  });
})();