import assert from 'node:assert/strict'
import {
  buildGoogleSheetCsvUrl,
  prepareSheetContacts,
} from '../lib/sheet-import'

const sheetUrl =
  'https://docs.google.com/spreadsheets/d/1luJ445rlT3C7XrSEretFqBEeUtkXWXfuiEs3igyHT-A/edit?gid=123#gid=123'

assert.equal(
  buildGoogleSheetCsvUrl(sheetUrl),
  'https://docs.google.com/spreadsheets/d/1luJ445rlT3C7XrSEretFqBEeUtkXWXfuiEs3igyHT-A/export?format=csv&gid=123'
)

assert.equal(
  buildGoogleSheetCsvUrl('https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing'),
  'https://docs.google.com/spreadsheets/d/abc123/export?format=csv'
)

const csv = [
  'Email,Company,Website,Title,Reason,Source URL',
  'hello@example.com,Example Co,example.com,Growth,valid but placeholder,https://example.com/contact',
  'founder@gmail.com,Founder Mail,gmail.com,Founder,personal mail,https://gmail.com',
  'support@realagency.com,Real Agency,realagency.com,Support,wrong inbox,https://realagency.com/contact',
  'sales@realagency.com,Real Agency,realagency.com,Growth,public sales inbox,https://realagency.com/contact',
  'sales@realagency.com,Real Agency,realagency.com,Growth,duplicate,https://realagency.com/contact',
  'hello@secondagency.com,Second Agency,secondagency.com,Partnerships,public hello inbox,',
].join('\n')

const prepared = prepareSheetContacts(csv, {
  sourceUrl: sheetUrl,
  limit: 20,
  dedupeByDomain: false,
})

assert.deepEqual(
  prepared.contacts.map((contact) => contact.email),
  ['sales@realagency.com', 'hello@secondagency.com']
)
assert.equal(prepared.rejected.length, 4)
assert.equal(prepared.summary.valid, 2)
assert.equal(prepared.contacts[0].customFields?.auto_approval_eligible, true)
assert.equal(prepared.contacts[1].customFields?.auto_approval_eligible, false)
assert.equal(prepared.contacts[0].customFields?.send_status, 'not_approved')

const estimatedCsv = [
  'Company Name,Website,Work Email (best estimated),Email Pattern,Why They Are A Fit',
  'Belkins,[URL],alex@belkins.io,first@domain,Heavy client outbound',
  'Verified Agency,https://verified.example/contact,sales@verified-agency.com,,Public contact page',
].join('\n')

const estimated = prepareSheetContacts(estimatedCsv, {
  sourceUrl: sheetUrl,
  limit: 20,
})

assert.deepEqual(
  estimated.contacts.map((contact) => contact.email),
  ['sales@verified-agency.com']
)
assert.equal(estimated.rejected[0].reason, 'estimated_email_needs_public_evidence')

const domainDedupe = prepareSheetContacts(csv, {
  sourceUrl: sheetUrl,
  limit: 20,
  dedupeByDomain: true,
})

assert.deepEqual(
  domainDedupe.contacts.map((contact) => contact.email),
  ['sales@realagency.com', 'hello@secondagency.com']
)

console.log('sheet import tests passed')
