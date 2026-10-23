const NAME = process.env.NAME || "basemap";
if (!/^[A-Za-z0-9_-]+$/.test(NAME)) throw new Error("NAME must be a simple filename without path separators.");
const STYLE = process.env.STYLE || "satellite"; // satellite | dark | light | raw {z}/{x}/{y} template
