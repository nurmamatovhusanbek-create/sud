'use client'

import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RefreshCw, Settings as SettingsIcon } from 'lucide-react'
import { UpdatesTab } from './UpdatesTab'
import { WorkersTab } from './WorkersTab'
import { HealthTab } from './HealthTab'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<'updates' | 'workers' | 'health'>('updates')
  const [refreshKey, setRefreshKey] = useState(0)

  const handleRefresh = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 gap-0 flex flex-col"
        style={{ maxWidth: '95vw', width: '95vw', height: '92vh', maxHeight: '92vh' }}
      >
        <DialogHeader className="px-8 pt-8 pb-4 shrink-0 pr-14">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2 text-lg">
                <SettingsIcon className="w-5 h-5" />
                Sozlamalar
              </DialogTitle>
              <DialogDescription className="mt-1">
                Yangilanishlar, workerlar va holatni boshqaring
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              className="gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Yangilash
            </Button>
          </div>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as any)}
          className="w-full flex-1 flex flex-col min-h-0"
        >
          <div className="px-8 pb-3 shrink-0">
            <TabsList className="grid w-full grid-cols-3 h-10">
              <TabsTrigger value="updates" className="text-sm">Yangilanishlar</TabsTrigger>
              <TabsTrigger value="workers" className="text-sm">Workerlar</TabsTrigger>
              <TabsTrigger value="health" className="text-sm">Holat</TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto px-8 pb-8">
            <TabsContent value="updates" className="mt-0">
              <UpdatesTab key={`updates-${refreshKey}`} />
            </TabsContent>
            <TabsContent value="workers" className="mt-0">
              <WorkersTab key={`workers-${refreshKey}`} />
            </TabsContent>
            <TabsContent value="health" className="mt-0">
              <HealthTab key={`health-${refreshKey}`} />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
