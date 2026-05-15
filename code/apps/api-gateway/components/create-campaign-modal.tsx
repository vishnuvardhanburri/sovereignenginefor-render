'use client'

import { useEffect, useRef, useState } from 'react'
import { useSequences, useCreateCampaign, useCreateSequence } from '@/lib/hooks'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'

const SAFE_DEFAULT_SEQUENCE = {
  name: 'Safe Infrastructure Review Sequence',
  steps: [
    {
      id: 'default-step-1',
      day: 0,
      subject: 'quick question on outbound reliability',
      body: `Hi {{first_name}},

I came across {{company}} and noticed outbound or partner-led growth may be part of your revenue workflow.

I built Sovereign Engine at Xavira Tech Labs to help teams review outbound infrastructure before volume increases: DNS alignment, provider throttling risk, domain reputation, queue pressure, bounce handling, and suppression hygiene.

Would a short 5-minute infrastructure review be useful?

Best,
Vishnu
Xavira Tech Labs

If this is not relevant, reply "no" and I will not follow up.`,
    },
    {
      id: 'default-step-2',
      day: 3,
      subject: 'worth checking before outbound scales?',
      body: `Hi {{first_name}},

Following up once here.

The reason I reached out is that many outbound-heavy teams only notice infrastructure issues after volume increases: Gmail or Outlook throttling, domain reputation drops, queue instability, or silent bounce growth.

I can share a concise review checklist your team can use to spot those risks early.

Worth sending over?

Best,
Vishnu`,
    },
    {
      id: 'default-step-3',
      day: 7,
      subject: 'should I close the loop?',
      body: `Hi {{first_name}},

Last note from me.

If outbound reliability is not a current priority at {{company}}, no problem. If it is, I can show the dashboard and risk-review workflow in a quick walkthrough.

Should I close the loop?

Best,
Vishnu`,
    },
  ],
}

export function CreateCampaignModal() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [sequenceId, setSequenceId] = useState('')
  const bootstrapRequested = useRef(false)
  const { data: sequences, isLoading: sequencesLoading } = useSequences()
  const { mutate: createCampaign, isPending } = useCreateCampaign()
  const {
    mutate: createDefaultSequence,
    isPending: sequenceBootstrapPending,
  } = useCreateSequence()

  useEffect(() => {
    if (!open || sequencesLoading || bootstrapRequested.current) return
    if (sequences && sequences.length > 0) {
      if (!sequenceId) {
        setSequenceId(sequences[0].id)
      }
      return
    }

    bootstrapRequested.current = true
    createDefaultSequence(SAFE_DEFAULT_SEQUENCE, {
      onSuccess: (sequence) => {
        setSequenceId(sequence.id)
      },
      onError: () => {
        bootstrapRequested.current = false
      },
    })
  }, [createDefaultSequence, open, sequenceId, sequences, sequencesLoading])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !sequenceId) return

    createCampaign(
      {
        name,
        sequenceId,
        sequenceName: sequences?.find((s) => s.id === sequenceId)?.name || '',
      },
      {
        onSuccess: () => {
          setName('')
          setSequenceId('')
          setOpen(false)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="shadow-sm">Create Campaign</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Campaign</DialogTitle>
          <DialogDescription>
            Set up a new email campaign with your selected sequence
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Campaign Name</Label>
            <Input
              id="name"
              placeholder="e.g., Q1 Outreach"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sequence">Select Sequence</Label>
            <Select
              value={sequenceId}
              onValueChange={setSequenceId}
              disabled={sequencesLoading || sequenceBootstrapPending || isPending}
            >
              <SelectTrigger id="sequence">
                <SelectValue
                  placeholder={
                    sequenceBootstrapPending
                      ? 'Creating safe default sequence...'
                      : 'Choose a sequence...'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {sequences?.map((seq) => (
                  <SelectItem key={seq.id} value={seq.id}>
                    {seq.name} ({seq.steps.length} steps)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              If no sequence exists, Sovereign Engine creates a safe infrastructure-review
              sequence automatically.
            </p>
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || sequenceBootstrapPending || !name || !sequenceId}
              className="gap-2"
            >
              {(isPending || sequenceBootstrapPending) && <Spinner className="w-4 h-4" />}
              Create Campaign
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
