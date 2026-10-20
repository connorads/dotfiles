      el.innerHTML = el.textContent.trim().split(/\s+/).map((w) => `<span aria-hidden="true" style="display:inline-block">${w}</span>`).join(' ');
