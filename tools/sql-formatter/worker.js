importScripts('https://unpkg.com/sql-formatter@15.3.2/dist/sql-formatter.min.js');
importScripts('schema_converter.js');

self.onmessage = function(e) {
    const { id, raw, action, lang, uppercase } = e.data;

    try {
        if (action === 'format') {
            const formatted = sqlFormatter.format(raw, {
                language: lang,
                uppercase: uppercase !== false,
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
            // Very simple heuristic
            let bestDialect = 'sql';
            const s = raw.toLowerCase();
            if (s.includes('auto_increment')) bestDialect = 'mysql';
            else if (s.includes('serial') || s.includes('jsonb') || s.includes('uuid_generate_v4()') || s.includes('gen_random_uuid()')) bestDialect = 'postgresql';
            else if (s.includes('plsql') || s.includes('varchar2')) bestDialect = 'plsql';

            const formatted = sqlFormatter.format(raw, {
                language: bestDialect,
                uppercase: uppercase !== false,
                linesBetweenQueries: 2
            });
            self.postMessage({ id, success: true, result: formatted, guessedDialect: bestDialect });
        }
    } catch (err) {
        self.postMessage({ id, success: false, error: err.message || "Unknown error" });
    }
};
