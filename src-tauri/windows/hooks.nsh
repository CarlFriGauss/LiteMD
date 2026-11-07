; Installation-only shell integration. No helper runs when LiteMD starts.
!include "WinMessages.nsh"
!macro LITEMD_PATH Action Script
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${Script}" -Action ${Action} -InstallDir "$INSTDIR"'
  Pop $R0
  Pop $R1
  ${If} $R0 != 0
    DetailPrint "LiteMD PATH integration failed ($R0): $R1"
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Windows could not update PATH. LiteMD can still be opened from the Start menu."
    ${EndIf}
  ${Else}
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Push $R0
  Push $R1
  Push $R2
  StrCpy $R2 "Add"
  ClearErrors
  ${GetOptions} $CMDLINE "/NOPATH" $R0
  ${IfNot} ${Errors}
    StrCpy $R2 "Remove"
  ${ElseIfNot} ${Silent}
  ${AndIf} $PassiveMode != 1
  ${AndIf} $UpdateMode != 1
    MessageBox MB_YESNO|MB_ICONQUESTION "Enable the litemd command in new terminals?" IDYES +2
    StrCpy $R2 "Remove"
  ${EndIf}
  !insertmacro LITEMD_PATH "$R2" "$INSTDIR\installer\path.ps1"
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  InitPluginsDir
  CopyFiles /SILENT "$INSTDIR\installer\path.ps1" "$PLUGINSDIR\litemd-path.ps1"
!macroend

; Only remove PATH after uninstall succeeds, so cancelling keeps shell integration.
!macro NSIS_HOOK_POSTUNINSTALL
  Push $R0
  Push $R1
  !insertmacro LITEMD_PATH "Remove" "$PLUGINSDIR\litemd-path.ps1"
  Pop $R1
  Pop $R0
!macroend
