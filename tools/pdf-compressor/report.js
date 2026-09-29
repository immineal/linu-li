/* What the PDF compressor tells the person about a result: the list under
   the size, the advice when the target was missed, and which page the
   preview opens on. Plain text from plain data, so
   tests/test-pdf-compressor.js reads every sentence without a browser.

   `r` is a result from Kompressor.compress; `s` is the session it came
   from, or anything with the same fields. */
(function (root, factory) {
    const E = typeof module === 'object' && module.exports ? require('./engine.js') : root.Verkleinerer;
    const api = factory(E);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Bericht = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
    'use strict';

    const MB = E.formatMB;
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

    function describe(r, s) {
        if (r.kind === 'original') {
            if (!r.notSmaller) {
                return [`The file is already ${MB(s.bytes.length)}, under the ${MB(r.target)} you picked, so nothing was changed. The download is your original file.`];
            }
            return [r.tried === 'pages'
                ? 'Turned into images, the pages came out larger than the original, so the download is your original file.'
                : 'Rewriting it did not make it any smaller, so the download is your original file.'];
        }
        const lines = r.kind === 'images' ? imageLines(r, s) : pageLines(r, s);
        if (s.signed) lines.push('This PDF was digitally signed. Any change to the file, this one included, means the signature no longer verifies.');
        return lines;
    }

    function imageLines(r, s) {
        const lines = [];
        const a = s.analysis;
        if (!r.level && a.candidates.length) lines.push('No image had to be touched. Writing the file out again more compactly was enough.');

        const t = s.tidyInfo;
        if (t.removed) lines.push(`Removed ${plural(t.removed, 'object', 'objects')} that nothing in the file refers to any more (${MB(t.removedBytes)}), usually earlier versions left behind by editing.`);
        if (t.deflated > 1000) lines.push(`Compressed parts that were stored uncompressed (${MB(t.deflated)} saved, without any loss).`);
        if (t.thumbs) lines.push(`Dropped ${plural(t.thumbs, 'embedded page thumbnail', 'embedded page thumbnails')}; viewers draw their own.`);

        let changed = 0, scaled = 0, lossless = 0, kept = 0, failed = 0, greyed = 0;
        for (const c of a.candidates) {
            const o = r.outcomes.get(c.key);
            if (s.failures.has(c.key)) { failed++; continue; }
            if (!o || !o.accept) { kept++; continue; }
            changed++;
            if (o.scale < 1) scaled++;
            if (o.res.filter === 'FlateDecode') lossless++;
            if (o.res.converted) greyed++;
        }
        const reasons = new Map();
        for (const sk of a.skipped) {
            if (sk.reason !== 'tiny') reasons.set(sk.reason, (reasons.get(sk.reason) || 0) + 1);
        }
        const total = a.candidates.length + [...reasons.values()].reduce((x, y) => x + y, 0);

        if (changed) {
            lines.push(`${changed} of ${plural(total, 'image', 'images')} rewritten.`);
            if (scaled) {
                lines.push(`${plural(scaled, 'image had', 'images had')} more pixels than ${r.level.ppi} ppi at the size ${scaled === 1 ? 'it is' : 'they are'} printed and ${scaled === 1 ? 'was' : 'were'} scaled down to that. ${E.verdict(r.level.ppi)}`);
            }
            const lossy = changed - lossless;
            if (lossy) lines.push(`${plural(lossy, 'image is', 'images are')} JPEG at quality ${Math.round(r.level.quality * 100)} now.`);
            if (lossless) lines.push(`${plural(lossless, 'image was', 'images were')} stored losslessly, which came out smaller for ${lossless === 1 ? 'it' : 'them'} than JPEG.`);
        } else if (r.level) {
            lines.push('No image got smaller by rewriting it.');
        }
        if (kept && r.level) lines.push(`${plural(kept, 'image was', 'images were')} left as they were, because rewriting saved less than a tenth.`);
        if (failed) lines.push(`${plural(failed, 'image', 'images')} could not be decoded by this browser and ${failed === 1 ? 'was' : 'were'} left as ${failed === 1 ? 'it was' : 'they were'}.`);
        for (const [reason, count] of reasons) {
            lines.push(`${plural(count, 'image', 'images')} left alone: ${E.REASONS[reason] || reason}.`);
        }
        if (greyed) {
            const cmyk = a.cmyk ? ` ${plural(a.cmyk, 'CMYK image keeps its', 'CMYK images keep their')} colour too; CMYK is never converted.` : '';
            lines.push(`${plural(greyed, 'image is', 'images are')} grey now. Text and drawings keep their colour.${cmyk}`);
        }
        lines.push('Text, fonts, drawings, links, bookmarks and form fields are as they were.');
        return lines;
    }

    function pageLines(r, s) {
        const lines = [`Every page is now a JPEG picture at ${r.level.dpi} dpi, quality ${Math.round(r.level.quality * 100)}. ${E.verdict(r.level.dpi)}`];
        if (r.capped) lines.push(`${plural(r.capped, 'page was', 'pages were')} too large to render at ${r.level.dpi} dpi in a browser and came out at less.`);
        lines.push('Text can no longer be selected, searched or read aloud, and links, bookmarks and form fields are gone.');
        if (r.opts.gray && !r.opts.clean) lines.push('Pages are grey.');
        if (r.opts.clean) lines.push(`Scan clean-up: grey, white from ${r.opts.white} up, black from ${r.opts.black} down.`);
        if (r.opts.angle) lines.push(`Every page turned by ${r.opts.angle.toFixed(1)}°.`);
        if (s.analysis && s.analysis.cmyk && !r.opts.gray && !r.opts.clean) {
            const one = s.analysis.cmyk === 1;
            lines.push(`${plural(s.analysis.cmyk, 'image is', 'images are')} CMYK, made for print. Drawn into the pages, ${one ? 'it goes' : 'they go'} through a generic print profile, so ${one ? 'its' : 'their'} colours can differ slightly from what the original shows in Acrobat.`);
        }
        if (s.encrypted) lines.push('The original was encrypted. The result is not.');
        return lines;
    }

    /* What to say when the target was missed, and whether turning the pages
       into images is worth offering. Null when there is nothing to say. */
    function advice(r, s) {
        if (r.fits) return null;
        const imagesMethod = r.kind === 'images' || (r.kind === 'original' && r.tried !== 'pages');
        if (imagesMethod && s.analysis && !s.analysis.candidates.length) {
            return {
                text: 'There are no images in this file that could be shrunk; its size is text, fonts and drawings. ' +
                    'Turning the pages into images reaches any size, at the cost of selectable text.',
                offerPages: true,
            };
        }
        if (imagesMethod) {
            return {
                text: `Shrinking the images gets it down to ${MB(r.bytes.length)}, not under ${MB(r.target)}. ` +
                    `About ${MB(s.baseBytes)} of the file is text, fonts and drawings, which this method does not touch. ` +
                    (r.stoppedEarly ? `It stopped at ${r.level.ppi} ppi because going further would have saved almost nothing. ` : '') +
                    'You can download this version anyway, or turn the pages into images, which reaches any size at the cost of selectable text.',
                offerPages: true,
            };
        }
        const splitting = 'Splitting the file, or keeping fewer pages, is the way under the limit from here.';
        if (r.kind === 'original') {
            return { text: 'Turning the pages into images did not help either: this file is smaller as it is. ' + splitting, offerPages: false };
        }
        return {
            text: (r.stoppedEarly
                ? `At ${r.level.dpi} dpi it is ${MB(r.bytes.length)}, and lower settings would save almost nothing more. `
                : `Even at ${r.level.dpi} dpi, the lowest setting, it is ${MB(r.bytes.length)}. `) +
                'That is as small as this tool makes it; the download is that version. ' + splitting,
            offerPages: false,
        };
    }

    /* Open the preview where the difference is largest: the page whose
       images lost the most, weighted by how much of the page they cover. */
    function previewPage(r, s) {
        if (r.kind !== 'images' || !s.analysis || !s.analysis.byPage) return { page: 1, chosen: false };
        const scaleOf = new Map();
        for (const c of s.analysis.candidates) {
            const o = r.outcomes.get(c.key);
            if (o && o.accept) scaleOf.set(c.key, o.scale);
        }
        let best = 0, page = 1;
        s.analysis.byPage.forEach((onPage, i) => {
            if (!onPage) return;
            let score = 0;
            for (const [key, area] of onPage) {
                if (scaleOf.has(key)) score += area * (1.05 - scaleOf.get(key));
            }
            if (score > best) { best = score; page = i + 1; }
        });
        return { page, chosen: best > 0 && s.analysis.byPage.length > 1 };
    }

    return { describe, advice, previewPage };
});
