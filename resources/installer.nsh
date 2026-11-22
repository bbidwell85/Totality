; Preserve user data during upgrades and silent uninstallations.
; An explicit interactive uninstall may remove it with user approval.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${ifNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Do you want to PERMANENTLY DELETE your Totality data?$\n$\nThis will remove your database, settings, and all scan history.$\nThis action cannot be undone.$\n$\nLocation: $APPDATA\totality" IDYES deleteAppData
      Goto keepAppData
      deleteAppData:
      RMDir /r "$APPDATA\totality"
      keepAppData:
    ${endIf}
  ${endIf}
!macroend
