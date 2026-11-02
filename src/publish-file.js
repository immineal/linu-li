#!/usr/bin/env node
/**
 * Puts files on linu.li/f/<name>.
 *
 *   node src/publish-file.js <path>[=<name>] ... [--replace]
 *
 * Copies each file into f/, adds the "-" line the deploy asks for, and prints
 * the addresses. Nothing is committed: pushing to main is what publishes.
 *
 * The files have to be in git. The deploy mirrors the checkout with --delete,
 * so anything put on the server by hand is gone after the next push.
 *
 * This sits in src/ because the deploy strips that directory. A script in the
 * root would be served to everyone.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORDNER = path.join(ROOT, 'f');
const NOTIZ = path.join(ROOT, 'assets/update-note.txt');

// A list of what may go in, not of what may not. f/ shares its origin with
// the tools, so an .html or .svg here would run as the site itself, inside
// the service worker's scope. The attachment header in f/.htaccess is the
// second line of defence, not the first.
const ENDUNGEN = ['mp3', 'wav', 'flac', 'zip', 'pdf'];

// Every CI run clones the repository, and a file stays in its history after
// it is deleted. GitHub itself refuses anything over 100 MB.
const MAX_BYTES = 50 * 1024 * 1024;

function nameFehler(name) {
    if (!/^[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*\.[a-z0-9]+$/.test(name)) {
        return `"${name}" is not a clean address: lower case letters, digits, - and _ only`;
    }
    const endung = name.split('.').pop();
    if (!ENDUNGEN.includes(endung)) {
        return `.${endung} is not allowed in f/, only ${ENDUNGEN.join(', ')}`;
    }
    return null;
}

function nameAus(quelle) {
    return path.basename(quelle).toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-.]+/, '');
}

const pruefsumme = (datei) => crypto.createHash('sha256').update(fs.readFileSync(datei)).digest('hex');

function veroeffentliche(quelle, name, ersetzen) {
    const fehler = nameFehler(name);
    if (fehler) throw new Error(fehler);
    const groesse = fs.statSync(quelle).size;
    if (groesse > MAX_BYTES) throw new Error(`${quelle} has ${groesse} bytes, the limit is ${MAX_BYTES}`);

    const ziel = path.join(ORDNER, name);
    if (fs.existsSync(ziel)) {
        if (pruefsumme(ziel) === pruefsumme(quelle)) return { name, neu: false };
        // A link out in the world promises the file it pointed at.
        if (!ersetzen) throw new Error(`f/${name} already exists with other content; --replace overwrites it`);
    }
    fs.copyFileSync(quelle, ziel);
    return { name, neu: true };
}

function main(argv) {
    const ersetzen = argv.includes('--replace');
    const paare = argv.filter((a) => a !== '--replace').map((a) => {
        const stelle = a.lastIndexOf('=');
        return stelle > 0 ? [a.slice(0, stelle), a.slice(stelle + 1)] : [a, nameAus(a)];
    });
    if (!paare.length) throw new Error('usage: node src/publish-file.js <path>[=<name>] ... [--replace]');

    // All of them or none: checked before the first copy, so a bad name in
    // the middle of a list leaves nothing half done.
    for (const [quelle, name] of paare) {
        const fehler = nameFehler(name);
        if (fehler) throw new Error(fehler);
        fs.statSync(quelle);
    }

    fs.mkdirSync(ORDNER, { recursive: true });
    const ergebnisse = paare.map(([quelle, name]) => veroeffentliche(quelle, name, ersetzen));

    // A "-" and not a sentence: a new download changes nothing for someone
    // using the tools, so nobody should be asked to update for it.
    if (ergebnisse.some((e) => e.neu)) fs.appendFileSync(NOTIZ, '-\n');

    for (const { name, neu } of ergebnisse) {
        console.log(`https://linu.li/f/${name}${neu ? '' : '  (unchanged)'}`);
    }
}

module.exports = { ENDUNGEN, MAX_BYTES, nameFehler, nameAus };

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (err) {
        console.error(err.message);
        process.exitCode = 1;
    }
}
