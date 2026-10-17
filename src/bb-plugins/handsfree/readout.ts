let owner: symbol | null = null;

export function createReadout() {
  const token = Symbol('handsfree-readout');
  const available = () => !!window.speechSynthesis && !!window.SpeechSynthesisUtterance;
  return {
    available,
    read(text: string, failed: (message: string) => void) {
      if (!available()) throw new Error('Speech output is unavailable on this device.');
      window.speechSynthesis.cancel();
      owner = token;
      const plain = text.replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1').replace(/[`*#>]/g, ' ').replace(/\s+/g, ' ').trim();
      let remaining = plain;
      while (remaining) {
        const boundary = remaining.length <= 1500 ? remaining.length : remaining.lastIndexOf(' ', 1500);
        const end = boundary > 0 ? boundary : Math.min(1500, remaining.length);
        const utterance = new SpeechSynthesisUtterance(remaining.slice(0, end));
        utterance.onerror = event => {
          if (owner === token && event.error !== 'interrupted' && event.error !== 'canceled') failed(`Speech output failed: ${event.error}.`);
        };
        window.speechSynthesis.speak(utterance);
        remaining = remaining.slice(end).trimStart();
      }
    },
    stop() {
      if (owner !== token) return;
      owner = null;
      window.speechSynthesis?.cancel();
    },
  };
}
