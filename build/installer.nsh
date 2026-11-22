; Entrada "Proyecto de HLab Interactive" en el men\u00fa Nuevo del Explorador (archivos .hl vac\u00edos).
; La asociaci\u00f3n del tipo de archivo la escribe electron-builder (fileAssociations).

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\.hl\ShellNew" "NullFile" ""
!macroend

!macro customUnInstall
  DeleteRegKey SHELL_CONTEXT "Software\Classes\.hl\ShellNew"
!macroend
