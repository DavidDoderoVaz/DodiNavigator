!include nsDialogs.nsh
!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
Var DodiDefaultBrowserCheckbox
Var DodiOpenDefaultSettings
!endif

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "DodiNavigator" "Software\Clients\StartMenuInternet\DodiNavigator\Capabilities"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\DodiNavigator" "" "DodiNavigator"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\DodiNavigator\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\DodiNavigator\shell\open\command" "" "$\"$appExe$\""
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\DodiNavigator\Capabilities" "ApplicationName" "DodiNavigator"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\DodiNavigator\Capabilities" "ApplicationDescription" "Navega por Internet con DodiNavigator."
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\DodiNavigator\Capabilities" "ApplicationIcon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\DodiNavigator\Capabilities\URLAssociations" "http" "DodiNavigatorURL"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\DodiNavigator\Capabilities\URLAssociations" "https" "DodiNavigatorURL"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\DodiNavigator\Capabilities\FileAssociations" ".htm" "DodiNavigatorHTML"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\DodiNavigator\Capabilities\FileAssociations" ".html" "DodiNavigatorHTML"

  WriteRegStr SHELL_CONTEXT "Software\Classes\DodiNavigatorURL" "" "DodiNavigator URL"
  WriteRegStr SHELL_CONTEXT "Software\Classes\DodiNavigatorURL" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\DodiNavigatorURL\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\DodiNavigatorURL\shell\open\command" "" "$\"$appExe$\" $\"%1$\""
  WriteRegStr SHELL_CONTEXT "Software\Classes\DodiNavigatorHTML" "" "DodiNavigator HTML Document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\DodiNavigatorHTML\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\DodiNavigatorHTML\shell\open\command" "" "$\"$appExe$\" $\"%1$\""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "DodiNavigator"
  DeleteRegKey SHELL_CONTEXT "Software\Clients\StartMenuInternet\DodiNavigator"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\DodiNavigatorURL"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\DodiNavigatorHTML"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customFinishPage
  Page custom DodiDefaultBrowserPageCreate DodiDefaultBrowserPageLeave

  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE DodiFinishPageLeave
  !define MUI_FINISHPAGE_TITLE "Instalación completada"
  !define MUI_FINISHPAGE_TEXT "DodiNavigator se instaló correctamente."
  !define MUI_FINISHPAGE_RUN "$launchLink"
  !define MUI_FINISHPAGE_RUN_TEXT "Iniciar DodiNavigator"
  !insertmacro MUI_PAGE_FINISH
!macroend

!ifndef BUILD_UNINSTALLER
Function DodiDefaultBrowserPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 32u "Navegador predeterminado\r\nDodiNavigator quedará disponible en la lista de navegadores de Windows."
  Pop $0
  ${NSD_CreateCheckbox} 0 42u 100% 30u "Abrir Configuración al terminar para elegir DodiNavigator como navegador predeterminado"
  Pop $DodiDefaultBrowserCheckbox
  StrCpy $DodiOpenDefaultSettings "0"
  nsDialogs::Show
FunctionEnd

Function DodiDefaultBrowserPageLeave
  ${NSD_GetState} $DodiDefaultBrowserCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $DodiOpenDefaultSettings "1"
  ${Else}
    StrCpy $DodiOpenDefaultSettings "0"
  ${EndIf}
FunctionEnd

Function DodiFinishPageLeave
  ${If} $DodiOpenDefaultSettings == "1"
    ExecShell "open" "ms-settings:defaultapps"
  ${EndIf}
FunctionEnd

!endif
