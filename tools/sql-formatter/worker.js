importScripts('../../assets/vendor/sql-formatter.min.js');
importScripts('schema_converter.js');

self.onmessage = function(e) {
    const { id, raw, action, lang, uppercase } = e.data;

    /* The vendored sql-formatter takes `keywordCase`, not `uppercase`.
       The old option name was a silent no-op, so lowercase input came back
       untouched even though the tool's description promised uppercase
       keywords. */
    const keywordCase = uppercase === false ? 'preserve' : 'upper';

    try {
        if (action === 'format') {
            const formatted = sqlFormatter.format(raw, {
                language: lang,
                keywordCase,
                linesBetweenQueries: 2
            });
            self.postMessage({ id, success: true, result: formatted });
        } else if (action === 'typescript') {
            const tsCode = parseSqlToSchema(raw, 'typescript');
            self.postMessage({ id, success: true, result: tsCode });
        } else if (action === 'prisma') {
            const prismaCode = parseSqlToSchema(raw, 'prisma');
            self.postMessage({ id, success: true, result: prismaCode });
        } else if (action === 'auto_detect') {
            // Looks for a few keywords only one dialect uses; anything else stays Standard SQL.
            let bestDialect = 'sql';
            const s = raw.toLowerCase();
            if (s.includes('auto_increment')) bestDialect = 'mysql';
            else if (s.includes('serial') || s.includes('jsonb') || s.includes('uuid_generate_v4()') || s.includes('gen_random_uuid()')) bestDialect = 'postgresql';
            else if (s.includes('plsql') || s.includes('varchar2')) bestDialect = 'plsql';

            const formatted = sqlFormatter.format(raw, {
                language: bestDialect,
                keywordCase,
                linesBetweenQueries: 2
            });
            self.postMessage({ id, success: true, result: formatted, guessedDialect: bestDialect });
        }
    } catch (err) {
        /* The raw parser error can be tens of kilobytes of grammar rules.
           Trim so the output box shows a first line the user can act on. */
        let msg = err.message || "Unknown error";
        const firstLine = msg.split('\n').find((l) => l.trim());
        if (firstLine && firstLine.length < msg.length) msg = firstLine.slice(0, 400);
        else if (msg.length > 400) msg = msg.slice(0, 400) + '…';
        self.postMessage({ id, success: false, error: msg });
    }
};
