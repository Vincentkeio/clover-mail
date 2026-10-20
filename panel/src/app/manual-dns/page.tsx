import { redirect } from 'next/navigation'

export default function ManualDnsPage() {
  redirect('/environment#domain-manager')
}
