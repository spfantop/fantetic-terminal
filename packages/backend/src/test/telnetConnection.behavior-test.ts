import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const schemaSource = fs.readFileSync(path.resolve('src/database/schema.ts'), 'utf8');
const migrationsSource = fs.readFileSync(path.resolve('src/database/migrations.ts'), 'utf8');
const serviceSource = fs.readFileSync(path.resolve('src/connections/connection.service.ts'), 'utf8');
const controllerSource = fs.readFileSync(path.resolve('src/connections/connections.controller.ts'), 'utf8');
const websocketSource = fs.readFileSync(path.resolve('src/websocket/connection.ts'), 'utf8');
const websocketTypesSource = fs.readFileSync(path.resolve('src/websocket/types.ts'), 'utf8');
const telnetHandlerSource = fs.readFileSync(path.resolve('src/telnet/telnet.handler.ts'), 'utf8');
const protocolTestServiceSource = fs.existsSync(path.resolve('src/services/protocol-test.service.ts'))
  ? fs.readFileSync(path.resolve('src/services/protocol-test.service.ts'), 'utf8')
  : '';

assert.match(schemaSource, /CHECK\(type IN \('SSH', 'RDP', 'VNC', 'TELNET'\)\)/);
assert.match(migrationsSource, /allow TELNET type/i);
assert.match(migrationsSource, /'TELNET'/);
assert.match(serviceSource, /'TELNET'/);
assert.match(serviceSource, /defaultPort\s*=\s*23/);
assert.match(serviceSource, /if \(!input\.host \|\| \(connectionType !== 'TELNET' && !input\.username\)\)/);
assert.match(serviceSource, /username:\s*normalizeConnectionUsername\(input\.username\)/);
assert.match(controllerSource, /ProtocolTestService\.testConnection\(connectionId\)/);
assert.match(protocolTestServiceSource, /export const testConnection/);
assert.match(protocolTestServiceSource, /connection\.type === 'SSH'/);
assert.match(protocolTestServiceSource, /connection\.type === 'TELNET' \|\| connection\.type === 'RDP' \|\| connection\.type === 'VNC'/);
assert.match(protocolTestServiceSource, /net\.createConnection/);
assert.match(websocketSource, /telnet:connect/);
assert.match(websocketSource, /handleTelnetConnect/);
assert.match(websocketTypesSource, /telnetService/);
assert.match(telnetHandlerSource, /payload\.sessionId/);
assert.doesNotMatch(telnetHandlerSource, /uuidv4\(\)/);

const telnetMigrationStart = migrationsSource.indexOf("name: 'Update connections table to allow TELNET type'");
assert.notEqual(telnetMigrationStart, -1, 'TELNET migration should exist');
const telnetMigrationSource = migrationsSource.slice(telnetMigrationStart);
assert.match(telnetMigrationSource, /ALTER TABLE connection_tags RENAME TO connection_tags_old_for_telnet_constraint_update/);
assert.match(telnetMigrationSource, /CREATE TABLE connection_tags/);
assert.match(telnetMigrationSource, /FOREIGN KEY \(connection_id\) REFERENCES connections\(id\) ON DELETE CASCADE/);
assert.match(telnetMigrationSource, /DROP TABLE connection_tags_old_for_telnet_constraint_update/);

const telnetFiles = [
  'src/telnet/telnet.types.ts',
  'src/telnet/telnet-negotiation.ts',
  'src/telnet/telnet.service.ts',
  'src/telnet/telnet.handler.ts',
];

for (const file of telnetFiles) {
  assert.equal(fs.existsSync(path.resolve(file)), true, `${file} should exist`);
}
