function splitColumns(columnsStr) {
    let columnLines = [];
    let currentLine = "";
    let parenDepth = 0;
    let inString = false;
    let stringChar = '';

    for (const char of columnsStr) {
        if (!inString && (char === "'" || char === '"' || char === '`')) {
            inString = true;
            stringChar = char;
        } else if (inString && char === stringChar) {
            inString = false;
        }

        if (!inString) {
            if (char === '(') parenDepth++;
            else if (char === ')') parenDepth--;
            else if (char === ',' && parenDepth === 0) {
                columnLines.push(currentLine.trim());
                currentLine = "";
                continue;
            }
        }
        currentLine += char;
    }
    if (currentLine.trim()) columnLines.push(currentLine.trim());

    return columnLines;
}

function parseSqlToSchema(sql, targetFormat) {
    let outputCode = "";
    let tablesFound = 0;

    // The regex only finds the opening paren. The body is found by counting
    // parens by hand, because column types like DECIMAL(10,2) nest inside it.
    const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)\s*\(/gi;
    let match;
    let lastIndex = 0;

    while ((match = regex.exec(sql)) !== null) {
        tablesFound++;
        const tableName = match[1];
        let bodyStart = regex.lastIndex;
        let parenDepth = 1;
        let inString = false;
        let stringChar = '';
        let bodyEnd = bodyStart;

        for (let i = bodyStart; i < sql.length; i++) {
            const char = sql[i];

            if (!inString && (char === "'" || char === '"' || char === '`')) {
                inString = true;
                stringChar = char;
                continue;
            }

            if (inString) {
                if (char === stringChar) inString = false;
                continue;
            }

            if (char === '(') {
                parenDepth++;
            } else if (char === ')') {
                parenDepth--;
                if (parenDepth === 0) {
                    bodyEnd = i;
                    break;
                }
            }
        }

        if (parenDepth !== 0) {
            continue; // Invalid/incomplete table definition
        }

        const columnsStr = sql.substring(bodyStart, bodyEnd);
        const structName = tableName.charAt(0).toUpperCase() + tableName.slice(1);

        let columnLines = splitColumns(columnsStr);

        if (targetFormat === 'typescript') {
            outputCode += `export interface ${structName} {\n`;
        } else if (targetFormat === 'prisma') {
            outputCode += `model ${structName} {\n`;
        }

        let primaryKeys = [];
        for (const line of columnLines) {
            const pkMatch = line.match(/^PRIMARY\s+KEY\s*\((.*?)\)/i);
            if (pkMatch) {
                primaryKeys = pkMatch[1].split(',').map(s => s.trim().replace(/[`"']/g, ''));
            }
        }

        for (const line of columnLines) {
            if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CONSTRAINT|INDEX|KEY)\b/i.test(line)) {
                continue;
            }

            const colMatch = line.match(/^[`"']?([a-zA-Z0-9_]+)[`"']?\s+([a-zA-Z0-9_]+)/);
            if (!colMatch) {
                continue;
            }

            const colName = colMatch[1];
            let colType = colMatch[2].toLowerCase();

            if (colType === 'serial' || colType === 'bigserial' || colType === 'smallserial') {
                colType = 'int';
            }

            const isNotNull = /NOT\s+NULL/i.test(line) || /PRIMARY\s+KEY/i.test(line);
            const isOptional = !isNotNull;

            if (targetFormat === 'typescript') {
                const tsType = getTypeScriptType(colType);
                outputCode += `  ${colName}${isOptional ? "?" : ""}: ${tsType};\n`;
            } else if (targetFormat === 'prisma') {
                const prismaType = getPrismaType(colType);

                let attrs = [];
                if (/PRIMARY\s+KEY/i.test(line) || primaryKeys.includes(colName)) attrs.push("@id");
                if (/AUTO_INCREMENT/i.test(line) || /SERIAL/i.test(colMatch[2])) attrs.push("@default(autoincrement())");
                if (/DEFAULT\s+(gen_random_uuid\(\)|uuid_generate_v4\(\))/i.test(line)) attrs.push("@default(uuid())");
                if (/UNIQUE/i.test(line)) attrs.push("@unique");

                outputCode += `  ${colName} ${prismaType}${isOptional ? "?" : ""} ${attrs.join(' ')}\n`.trimEnd() + '\n';
            }
        }

        if (targetFormat === 'prisma' && primaryKeys.length > 1) {
            outputCode += `  @@id([${primaryKeys.join(', ')}])\n`;
        }

        outputCode += `}\n\n`;

        // Carry on after this table's closing paren.
        regex.lastIndex = bodyEnd + 1;
    }

    if (tablesFound === 0) {
        return "/* No CREATE TABLE statements found to convert. */\n" +
               "/* Paste CREATE TABLE statements to get interfaces or models out. */";
    }

    return outputCode.trim();
}

function getTypeScriptType(colType) {
    if (['int', 'integer', 'tinyint', 'smallint', 'mediumint', 'bigint', 'float', 'double', 'decimal', 'numeric', 'real'].includes(colType)) return "number";
    if (['bool', 'boolean', 'bit'].includes(colType)) return "boolean";
    if (['date', 'datetime', 'timestamp', 'time', 'year'].includes(colType)) return "Date";
    if (['json', 'jsonb'].includes(colType)) return "any";
    return "string";
}

function getPrismaType(colType) {
    if (['int', 'integer', 'tinyint', 'smallint', 'mediumint', 'bigint'].includes(colType)) return "Int";
    if (['float', 'double', 'decimal', 'numeric', 'real'].includes(colType)) return "Float";
    if (['bool', 'boolean', 'bit'].includes(colType)) return "Boolean";
    if (['date', 'datetime', 'timestamp', 'time', 'year'].includes(colType)) return "DateTime";
    if (['json', 'jsonb'].includes(colType)) return "Json";
    return "String";
}
