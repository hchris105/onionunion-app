(function(){
  const key = "theme";
  const btn = document.getElementById("themeToggle");

  function setTheme(mode){ // mode: 'dark'|'light'
    document.body.classList.remove("theme-dark","theme-light");
    document.body.classList.add(mode === "light" ? "theme-light" : "theme-dark");
    localStorage.setItem(key, mode);
  }

  // 初始化
  const saved = localStorage.getItem(key);
  if (saved) setTheme(saved);
  else {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(prefersDark ? "dark" : "light");
  }

  btn.addEventListener("click", ()=>{
    const isDark = document.body.classList.contains("theme-dark");
    setTheme(isDark ? "light" : "dark");
  });
})();
