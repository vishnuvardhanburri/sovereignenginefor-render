'use client'

import { useState } from 'react'
import { useApproveContacts, useContacts, useDeleteContact } from '@/lib/hooks'
import { Contact } from '@/lib/api'
import { UploadContactsModal } from '@/components/upload-contacts-modal'
import { AddContactModal } from '@/components/add-contact-modal'
import { LeadScoutCard } from '@/components/lead-scout-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle2, Search, Trash2 } from 'lucide-react'

export default function ContactsPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const { data: contacts, isLoading } = useContacts()
  const { mutate: deleteContact } = useDeleteContact()
  const { mutate: approveContacts, isPending: approving } = useApproveContacts()

  const filteredContacts = contacts
    ?.filter((contact: Contact) => {
      const matchesSearch = 
        contact.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.name.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesStatus = statusFilter === 'all' || contact.status === statusFilter
      return matchesSearch && matchesStatus
    })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/10 text-green-500'
      case 'replied':
        return 'bg-blue-500/10 text-blue-500'
      case 'bounced':
        return 'bg-red-500/10 text-red-500'
      default:
        return 'bg-gray-500/10 text-gray-500'
    }
  }

  const isApproved = (contact: Contact) => contact.customFields?.send_status === 'approved'

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Prospects</h1>
          <p className="text-muted-foreground">Import and manage your prospect database</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => approveContacts({})}
            disabled={approving}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {approving ? 'Approving...' : 'Approve Verified Recommended'}
          </Button>
          <AddContactModal />
          <UploadContactsModal />
        </div>
      </div>

      <LeadScoutCard />

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by email or name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="replied">Replied</SelectItem>
                <SelectItem value="bounced">Bounced</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Prospects ({filteredContacts?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Outreach</TableHead>
                  <TableHead>Added Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array(5)
                    .fill(0)
                    .map((_, i) => (
                      <TableRow key={i}>
                        {Array(7)
                          .fill(0)
                          .map((_, j) => (
                            <TableCell key={j}>
                              <Skeleton className="h-4 w-full" />
                            </TableCell>
                          ))}
                      </TableRow>
                    ))
                ) : filteredContacts && filteredContacts.length > 0 ? (
                  filteredContacts.map((contact: Contact) => (
                    <TableRow key={contact.id}>
                      <TableCell className="font-medium">{contact.email}</TableCell>
                      <TableCell>{contact.name}</TableCell>
                      <TableCell>{contact.company}</TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(contact.status)}>
                          {contact.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {isApproved(contact) ? (
                          <Badge className="bg-emerald-500/10 text-emerald-500">
                            approved
                          </Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => approveContacts({ ids: [contact.id] })}
                            disabled={approving || contact.status !== 'active'}
                          >
                            Approve
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        {contact.addedAt.toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteContact(contact.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No contacts found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
