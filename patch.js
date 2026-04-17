const fs = require('fs');
let content = fs.readFileSync('tools/sql-formatter/schema_converter.js', 'utf8');

const conflictBlock = `<<<<<<< HEAD
        let columnLines = [];
        let currentLine = "";
        parenDepth = 0;
        inString = false;

        for (let i = 0; i < columnsStr.length; i++) {
            const char = columnsStr[i];

            if (!inString && (char === "'" || char === '"' || char === '`')) {
                inString = true;
                stringChar = char;
                currentLine += char;
                continue;
            }

            if (inString) {
                if (char === stringChar) inString = false;
                currentLine += char;
                continue;
            }

            if (char === '(') {
                parenDepth++;
            } else if (char === ')') {
                parenDepth--;
            } else if (char === ',' && parenDepth === 0) {
                columnLines.push(currentLine.trim());
                currentLine = "";
                continue;
            }

            currentLine += char;
        }
        if (currentLine.trim()) columnLines.push(currentLine.trim());
=======
        let columnLines = splitColumns(columnsStr);
>>>>>>> origin/main`;

content = content.replace(conflictBlock, `        let columnLines = splitColumns(columnsStr);`);
fs.writeFileSync('tools/sql-formatter/schema_converter.js', content);
