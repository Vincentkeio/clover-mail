import { notFound, redirect } from 'next/navigation'

export default async function DomainDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id < 1) notFound()
  redirect(`/environment?domain=${id}#domain-dns`)
}
