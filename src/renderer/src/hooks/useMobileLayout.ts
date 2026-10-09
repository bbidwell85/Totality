import { useState, useEffect } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'
const TABLET_QUERY = '(min-width: 768px) and (max-width: 1023px)'

export function useMobileLayout(): { isMobile: boolean; isTablet: boolean } {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  const [isTablet, setIsTablet] = useState(() => window.matchMedia(TABLET_QUERY).matches)

  useEffect(() => {
    const mobileMql = window.matchMedia(MOBILE_QUERY)
    const tabletMql = window.matchMedia(TABLET_QUERY)
    const mobileHandler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    const tabletHandler = (e: MediaQueryListEvent) => setIsTablet(e.matches)
    mobileMql.addEventListener('change', mobileHandler)
    tabletMql.addEventListener('change', tabletHandler)
    return () => {
      mobileMql.removeEventListener('change', mobileHandler)
      tabletMql.removeEventListener('change', tabletHandler)
    }
  }, [])

  return { isMobile, isTablet }
}
