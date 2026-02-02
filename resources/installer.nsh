; Custom NSIS uninstall script for Totality
; Ensures complete cleanup of installation directory and optionally app data

!macro customUnInstall
  ; Ask user if they want to delete app data BEFORE removing install dir
  MessageBox MB_YESNO|MB_ICONQUESTION "Do you also want to delete your Totality data (database, settings)?$\n$\nLocation: $APPDATA\totality" IDYES deleteAppData IDNO skipDelete

  deleteAppData:
    RMDir /r "$APPDATA\totality"

  skipDelete:
    ; Remove installation directory completely (fixes leftover files issue)
    RMDir /r "$INSTDIR"
!macroend
