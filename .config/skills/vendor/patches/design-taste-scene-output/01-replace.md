    const filename = /^[a-zA-Z0-9_-]+$/.test(sc.id) ? sc.id : '%' + createHash('sha256').update(Buffer.from(sc.id, 'utf16le')).digest('hex');
    const path = join(outDir, `${filename}-${label}.jpg`);
