import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../src/components/PartnerCapitalView.tsx',import.meta.url),'utf8');

test('partner financial functions are separate navigable workspaces, not one long page',()=>{
  assert.match(ui,/type PartnerWorkspace='overview'\|'partners'\|'agreements'\|'capital'\|'profits'\|'history'\|'statement'/);
  assert.match(ui,/aria-label="Partner management workspaces"/);
  assert.match(ui,/aria-current=\{workspace===id\?'page':undefined\}/);
  for(const workspace of ['overview','partners','agreements','capital','profits','history','statement']){
    assert.match(ui,new RegExp("workspace==='"+workspace+"'"));
  }
  assert.match(ui,/onClick=\{\(\)=>\{setWorkspace\(id\)/);
});
test('capital and ownership history remain accessible on dedicated screens',()=>{
  assert.match(ui,/workspace==='capital'&&<section aria-label="Record partner capital"/);
  assert.match(ui,/workspace==='capital'&&<section aria-label="Partner capital entries"/);
  assert.match(ui,/workspace==='history'&&<section aria-label="Partner ownership audit"/);
  assert.match(ui,/workspace==='profits'&&<section aria-label="Approved partner profit allocation"/);
  assert.match(ui,/workspace==='agreements'&&<section aria-label="Effective-dated ownership agreements"/);
  assert.match(ui,/Super Admin Only · Confidential/);
  assert.match(ui,/Post capital and accounting journal/);
  assert.match(ui,/\/api\/ars\/partner-capital\/post/);
  assert.match(ui,/Retry exact request/);
  assert.match(ui,/Record approved allocation \(no money transfer\)/);
});

test('individual partner statement is a dedicated paginated workspace',()=>{
  assert.match(ui,/workspace==='statement'&&<PartnerStatementPanel/);
  const statement=readFileSync(new URL('../src/components/PartnerStatementPanel.tsx',import.meta.url),'utf8');
  assert.match(statement,/capital-statement\?/);
  assert.match(statement,/Opening recorded capital/);
  assert.match(statement,/Closing recorded capital/);
  assert.match(statement,/running_balance/);
  assert.match(statement,/Previous/);
  assert.match(statement,/Next/);
});
