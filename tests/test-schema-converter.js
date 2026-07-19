const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '../tools/sql-formatter/schema_converter.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { parseSqlToSchema } = sandbox;

function runTests() {
    console.log("Running schema converter tests...");
    let failed = 0;

    function runTest(name, fn) {
        try {
            fn();
            console.log(`✅ ${name}`);
        } catch (e) {
            console.error(`❌ ${name}`);
            console.error(e.message);
            failed++;
        }
    }

    runTest("Basic conversion to TypeScript", () => {
        const sql = `CREATE TABLE users (
            id serial PRIMARY KEY,
            name varchar(255) NOT NULL,
            created_at timestamp
        );`;
        const result = parseSqlToSchema(sql, 'typescript');
        assert.ok(result.includes("export interface Users {"));
        assert.ok(result.includes("id: number;"));
        assert.ok(result.includes("name: string;"));
        assert.ok(result.includes("created_at?: Date;"));
    });

    runTest("Basic conversion to Prisma", () => {
        const sql = `CREATE TABLE products (
            id serial PRIMARY KEY,
            price decimal NOT NULL,
            is_active boolean DEFAULT true
        );`;
        const result = parseSqlToSchema(sql, 'prisma');
        assert.ok(result.includes("model Products {"));
        assert.ok(result.includes("id Int @id @default(autoincrement())"));
        assert.ok(result.includes("price Float"));
        assert.ok(result.includes("is_active Boolean?"));
    });

    runTest("Prisma unique and uuid attributes", () => {
        const sql = `CREATE TABLE accounts (
            id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
            email varchar(255) UNIQUE NOT NULL
        );`;
        const result = parseSqlToSchema(sql, 'prisma');
        assert.ok(result.includes("model Accounts {"));
        assert.ok(result.includes("id String @id @default(uuid())"));
        assert.ok(result.includes("email String @unique"));
    });

    runTest("Prisma composite primary keys", () => {
        const sql = `CREATE TABLE user_roles (
            user_id int NOT NULL,
            role_id int NOT NULL,
            PRIMARY KEY (user_id, role_id)
        );`;
        const result = parseSqlToSchema(sql, 'prisma');
        assert.ok(result.includes("user_id Int @id"));
        assert.ok(result.includes("role_id Int @id"));
        assert.ok(result.includes("@@id([user_id, role_id])"));
    });

    runTest("Fallback message for no valid CREATE TABLE statements", () => {
        const sql = `SELECT * FROM users;`;
        const result = parseSqlToSchema(sql, 'typescript');
        assert.ok(result.includes("No CREATE TABLE statements found to convert."));
    });

    runTest("Handling of string literals and parentheses inside table definition", () => {
        const sql = `CREATE TABLE test (
            id int PRIMARY KEY,
            status enum('active', 'inactive', 'pending') DEFAULT 'active'
        );`;
        const result = parseSqlToSchema(sql, 'typescript');
        assert.ok(result.includes("status?: string;"));
    });

    runTest("Multiple CREATE TABLE statements", () => {
        const sql = `
            CREATE TABLE t1 (id int PRIMARY KEY);
            CREATE TABLE t2 (id int PRIMARY KEY);
        `;
        const result = parseSqlToSchema(sql, 'typescript');
        assert.ok(result.includes("export interface T1 {"));
        assert.ok(result.includes("export interface T2 {"));
    });

    runTest("Constraints as separate lines are ignored in fields", () => {
        const sql = `CREATE TABLE t3 (
            id int,
            PRIMARY KEY (id),
            FOREIGN KEY (id) REFERENCES t4(id),
            UNIQUE (id),
            CONSTRAINT fk_id FOREIGN KEY (id) REFERENCES t4(id),
            INDEX (id),
            KEY (id)
        );`;
        const result = parseSqlToSchema(sql, 'typescript');
        // Ensure no invalid properties are exported for these constraints
        assert.ok(!result.includes("PRIMARY: string;"));
        assert.ok(!result.includes("FOREIGN: string;"));
        assert.ok(!result.includes("UNIQUE: string;"));
        assert.ok(!result.includes("CONSTRAINT: string;"));
        assert.ok(!result.includes("INDEX: string;"));
        assert.ok(!result.includes("KEY: string;"));
        // Only "id" should be mapped
        assert.ok(result.includes("id?: number;"));
    });

    if (failed > 0) {
        console.error(`\n💥 ${failed} tests failed.`);
        process.exit(1);
    } else {
        console.log(`\n🎉 All tests passed successfully!`);
    }
}

runTests();
