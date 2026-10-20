  const text = (parent, str, attrs) => { const t = svg('text', attrs, parent); t.textContent = str; return t; };
  const titled = (parent, str) => { svg('title', {}, parent).textContent = str; return parent; };
