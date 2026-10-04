export function parseGISSData(text) {
    const lines = text.trim().split('\n');
    const data = [];
    const yearRegex = /^\s*(\d{4})/;
    let scaleFactor = 1.0;
    let checkedScale = false;

    lines.forEach(line => {
        if (yearRegex.test(line)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
                if (!checkedScale) {
                    // Retain compatibility with native hundredths and legacy decimal-Celsius imports.
                    const rawVal = parts[1].replace(/\*/g, '');
                    const valTest = parseFloat(rawVal);
                    if (!isNaN(valTest) && Math.abs(valTest) > 10) {
                        scaleFactor = 0.01;
                    }
                    checkedScale = true;
                }
                const year = parseInt(parts[0]);
                const anomalies = [];
                const fractions = [];
                for (let i = 1; i <= 12; i++) {
                    if (i >= parts.length) break;
                    const clean = parts[i].replace(/\*/g, '');
                    if (clean === '') break;
                    const val = parseFloat(clean);
                    if (isNaN(val)) break;
                    anomalies.push(val * scaleFactor);
                    fractions.push((i - 1) / 12);
                }
                if (anomalies.length > 0) {
                    data.push({ year, anomalies, fractions });
                }
            }
        }
    });
    return data;
}
