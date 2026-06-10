import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'

type QueryLoadOptions = {
  enabled?: boolean
  refetchInterval?: number | false
}

// Campaigns
export const useCampaigns = (options: QueryLoadOptions = {}) => {
  return useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api.campaigns.getAll(),
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  })
}

export const useCampaign = (id: string) => {
  return useQuery({
    queryKey: ['campaigns', id],
    queryFn: () => api.campaigns.getById(id),
    enabled: !!id,
    placeholderData: keepPreviousData,
  })
}

export const useCreateCampaign = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; sequenceId: string; sequenceName: string }) =>
      api.campaigns.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      toast.success('Campaign created successfully')
    },
    onError: () => {
      toast.error('Failed to create campaign')
    },
  })
}

export const useUpdateCampaignStatus = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'paused' | 'completed' }) =>
      api.campaigns.updateStatus(id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['campaigns'] })
      const previous = queryClient.getQueryData(['campaigns'])
      queryClient.setQueryData(['campaigns'], (old: any) =>
        old?.map((c: any) => (c.id === id ? { ...c, status } : c))
      )
      return { previous }
    },
    onError: (err, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['campaigns'], context.previous)
      }
      toast.error('Failed to update campaign')
    },
    onSuccess: () => {
      toast.success('Campaign updated')
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    },
  })
}

// Contacts
export const useContacts = () => {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: () => api.contacts.getAll(),
    placeholderData: keepPreviousData,
  })
}

export const useBulkCreateContacts = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Array<{ email: string; name: string; company: string }>) =>
      api.contacts.bulkCreate(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      toast.success(`${data.length} contacts uploaded successfully`)
    },
    onError: () => {
      toast.error('Failed to upload contacts')
    },
  })
}

export const useImportContactsCsv = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { csv: string; dedupeByDomain?: boolean; verify?: boolean; enrich?: boolean; sourceOverride?: string }) =>
      api.contacts.importCsv(input),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      toast.success(`${result.imported} prospects imported`)
    },
    onError: () => {
      toast.error('Failed to import prospects')
    },
  })
}

export const useImportContactsPreview = () => {
  return useMutation({
    mutationFn: (file: File) => api.contacts.importPreview(file),
    onError: () => {
      toast.error('Failed to preview import')
    },
  })
}

export const useImportContactsFile = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { file: File; mapping: Record<string, string>; verify?: boolean; dedupeByDomain?: boolean }) =>
      api.contacts.importFile(input),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      toast.success(`${result.imported} prospects imported`)
    },
    onError: () => {
      toast.error('Failed to import prospects')
    },
  })
}

export const useDeleteContact = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.contacts.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      toast.success('Contact deleted')
    },
    onError: () => {
      toast.error('Failed to delete contact')
    },
  })
}

export const useApproveContacts = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { ids?: string[]; limit?: number }) => api.contacts.approve(input),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      const held = Number((result as any).held ?? (result as any).blocked?.length ?? 0)
      toast.success(
        result.approved > 0
          ? `${result.approved} prospect${result.approved === 1 ? '' : 's'} approved${held > 0 ? `; ${held} held by Hunter gate` : ''}`
          : held > 0
            ? `${held} prospect${held === 1 ? '' : 's'} held by Hunter gate`
          : 'No reviewable prospects found'
      )
    },
    onError: () => {
      toast.error('Failed to approve prospects')
    },
  })
}

export const useResearchApproveContacts = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { dryRun?: boolean; limit?: number; threshold?: number } = {}) =>
      api.contacts.researchApprove(input),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      const approved = Number(result.approved ?? result.approvalReady ?? 0)
      if (result.dryRun) {
        toast.success(`${approved} research-verified prospects ready; ${result.blocked?.length ?? 0} blocked for review`)
        return
      }

      toast.success(
        approved > 0
          ? `${approved} research-verified prospect${approved === 1 ? '' : 's'} approved`
          : 'No research-verified prospects found'
      )
    },
    onError: () => {
      toast.error('Research approval failed')
    },
  })
}

// Sequences
export const useSequences = () => {
  return useQuery({
    queryKey: ['sequences'],
    queryFn: () => api.sequences.getAll(),
    placeholderData: keepPreviousData,
  })
}

export const useSequence = (id: string) => {
  return useQuery({
    queryKey: ['sequences', id],
    queryFn: () => api.sequences.getById(id),
    enabled: !!id,
    placeholderData: keepPreviousData,
  })
}

export const useCreateSequence = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; steps: any[] }) =>
      api.sequences.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequences'] })
      toast.success('Sequence created successfully')
    },
    onError: () => {
      toast.error('Failed to create sequence')
    },
  })
}

export const useUpdateSequence = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name: string; steps: any[] } }) =>
      api.sequences.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequences'] })
      toast.success('Sequence updated successfully')
    },
    onError: () => {
      toast.error('Failed to update sequence')
    },
  })
}

// Replies
export const useReplies = () => {
  return useQuery({
    queryKey: ['replies'],
    queryFn: () => api.replies.getAll(),
    placeholderData: keepPreviousData,
  })
}

export const useReply = (id: string) => {
  return useQuery({
    queryKey: ['replies', id],
    queryFn: () => api.replies.getById(id),
    enabled: !!id,
    placeholderData: keepPreviousData,
  })
}

export const useUpdateReplyStatus = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'unread' | 'interested' | 'not_interested' }) =>
      api.replies.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replies'] })
      toast.success('Reply status updated')
    },
    onError: () => {
      toast.error('Failed to update reply status')
    },
  })
}

// Analytics
export const useAnalytics = () => {
  return useQuery({
    queryKey: ['analytics'],
    queryFn: () => api.analytics.getAll(),
    placeholderData: keepPreviousData,
  })
}

// Activity
export const useActivityFeed = () => {
  return useQuery({
    queryKey: ['activity'],
    queryFn: () => api.activity.getRecent(),
    placeholderData: keepPreviousData,
  })
}

// Dashboard Stats
export const useDashboardStats = () => {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.dashboard.getStats(),
    refetchInterval: 8000,
    staleTime: 2000,
    placeholderData: keepPreviousData,
  })
}

// Chart Data
export const useChartData = (options: QueryLoadOptions = {}) => {
  return useQuery({
    queryKey: ['chart-data'],
    queryFn: () => api.dashboard.getChartData(),
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  })
}

export const useQueueStats = () => {
  return useQuery({
    queryKey: ['queue-stats'],
    queryFn: () => api.queue.getStats(),
    refetchInterval: 8000,
    staleTime: 2000,
  })
}

export const useInfrastructureHealth = () => {
  return useQuery({
    queryKey: ['infra-health'],
    queryFn: () => api.infrastructure.getHealth(),
    refetchInterval: 30000,
    staleTime: 15000,
  })
}

export const useInfrastructureAnalytics = (options: QueryLoadOptions = {}) => {
  return useQuery({
    queryKey: ['infra-analytics'],
    queryFn: () => api.infrastructure.getAnalytics(),
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval ?? 45000,
    staleTime: 30000,
  })
}

export const usePatterns = (options: QueryLoadOptions = {}) => {
  return useQuery({
    queryKey: ['patterns'],
    queryFn: () => api.patterns.getAll(),
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval ?? 60000,
    staleTime: 30000,
  })
}

export const useRecentEvents = (limit = 50, options: QueryLoadOptions = {}) => {
  return useQuery({
    queryKey: ['events', limit],
    queryFn: () => api.events.getRecent(limit),
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval ?? 30000,
    staleTime: 15000,
  })
}

export const useOperatorActions = (limit = 60, options: QueryLoadOptions = {}) => {
  return useQuery({
    queryKey: ['operator-actions', limit],
    queryFn: () => api.operator.getActions(limit),
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval ?? 45000,
    staleTime: 20000,
  })
}

export const useExecutiveSummary = (options: QueryLoadOptions = {}) => {
  return useQuery({
    queryKey: ['executive-summary'],
    queryFn: () => api.executive.getSummary(),
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval ?? 45000,
    staleTime: 20000,
  })
}

export const useExecutiveForecast = (days = 5, options: QueryLoadOptions = {}) => {
  return useQuery({
    queryKey: ['executive-forecast', days],
    queryFn: () => api.executive.getForecast(days),
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval ?? 60000,
    staleTime: 30000,
  })
}

export const useInfrastructureControl = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ action, payload }: { action: Parameters<typeof api.infrastructure.control>[0]; payload?: Record<string, unknown> }) =>
      api.infrastructure.control(action, payload ?? {}),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['infra-health'] }),
        queryClient.invalidateQueries({ queryKey: ['infra-analytics'] }),
        queryClient.invalidateQueries({ queryKey: ['queue-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['operator-actions'] }),
        queryClient.invalidateQueries({ queryKey: ['executive-summary'] }),
      ])
      if (result.success) toast.success('Action applied')
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Control action failed')
    },
  })
}
