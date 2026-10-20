import EnvironmentView from './environment-view'

export default async function EnvironmentPage({ searchParams }: { searchParams: Promise<{ domain?: string }> }) {
  const rawDomainId = (await searchParams).domain
  const initialDomainId = rawDomainId && /^\d+$/.test(rawDomainId) ? Number(rawDomainId) : undefined
  return <EnvironmentView mode="setup" manageDomains initialDomainId={initialDomainId} />
}
