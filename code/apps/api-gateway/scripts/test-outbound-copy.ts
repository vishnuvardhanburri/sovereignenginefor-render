import {
  inferSovereignOfferType,
  renderSovereignTemplate,
  sovereignBodyForLead,
  sovereignSubjectForLead,
} from '@/lib/outbound-copy'

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

const directLead = {
  first_name: 'Ava',
  company: 'Example SaaS',
  companyDomain: 'example-saas.com',
  title: 'RevOps',
  reason_to_contact: 'active outbound campaigns',
}

const agencyLead = {
  first_name: 'Maya',
  company: 'Example Agency',
  companyDomain: 'example-agency.com',
  title: 'partnerships team',
  reason_to_contact: 'agency outreach because it shows public signals around demand generation',
}

assert(inferSovereignOfferType(directLead) === 'direct', 'direct lead should use $25k copy')
assert(inferSovereignOfferType(agencyLead) === 'agency', 'agency lead should use master-license copy')
assert(
  sovereignSubjectForLead(directLead).includes('outbound deliverability'),
  'direct subject should use requested copy'
)
assert(
  sovereignSubjectForLead(agencyLead).includes('White-label outbound'),
  'agency subject should use requested copy'
)

const directBody = renderSovereignTemplate(
  sovereignBodyForLead(directLead),
  directLead,
  'Xavira Tech Labs, India'
)
assert(directBody.includes('Sovereign Stack'), 'direct body should mention Sovereign Stack')
assert(directBody.includes('$25k one-time license'), 'direct body should mention $25k one-time license')
assert(directBody.includes('Example SaaS'), 'direct body should render company')
assert(!directBody.includes('{{'), 'direct body should render all placeholders')

const agencyBody = renderSovereignTemplate(
  sovereignBodyForLead(agencyLead),
  agencyLead,
  'Xavira Tech Labs, India'
)
assert(agencyBody.includes('$100k one-time'), 'agency body should mention $100k master license')
assert(agencyBody.includes('white-labeled deployments'), 'agency body should mention white-label value')
assert(!agencyBody.includes('{{'), 'agency body should render all placeholders')

console.log('outbound copy tests passed')
