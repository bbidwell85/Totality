/**
 * EnhancedEmptyState Component
 *
 * Simplified empty state shown when onboarding is complete but no sources configured.
 */

export function EnhancedEmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-8">
      <h2 className="text-xl font-semibold text-foreground mb-2 text-center">
        No Media Sources
      </h2>
      <p className="text-muted-foreground text-center max-w-md">
        Add a media server from the sidebar to start analyzing your library
      </p>
    </div>
  )
}
