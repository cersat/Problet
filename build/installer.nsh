; Установщик Windows: выбор между обычной установкой и портативной (в любую папку, без следов в системе)
!include nsDialogs.nsh
!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
	Var portableMode
	Var portableRadioNormal
	Var portableRadioPortable
!endif

!macro customWelcomePage
	Page custom portablePageShow portablePageLeave

	Function portablePageShow
		${If} ${Silent}
			Abort
		${EndIf}
		${If} ${isUpdated}
			Abort
		${EndIf}
		nsDialogs::Create 1018
		Pop $0
		${If} $LANGUAGE == 1049
			${NSD_CreateLabel} 0 0 100% 24u "Как установить Problet?"
			Pop $0
			${NSD_CreateRadioButton} 0 30u 100% 24u "Обычная установка: ярлыки в меню и на рабочем столе, удаление через «Приложения»"
			Pop $portableRadioNormal
			${NSD_AddStyle} $portableRadioNormal ${WS_GROUP}
			${NSD_CreateRadioButton} 0 58u 100% 36u "Портативная: программа и все её данные лежат в одной выбранной папке. Ярлыков и записей в системе не будет, папку можно перенести или стереть"
			Pop $portableRadioPortable
		${Else}
			${NSD_CreateLabel} 0 0 100% 24u "How do you want to install Problet?"
			Pop $0
			${NSD_CreateRadioButton} 0 30u 100% 24u "Regular: shortcuts in the menu and on the desktop, removal through Apps"
			Pop $portableRadioNormal
			${NSD_AddStyle} $portableRadioNormal ${WS_GROUP}
			${NSD_CreateRadioButton} 0 58u 100% 36u "Portable: the program and all its data live in one folder you choose. No shortcuts or system entries; the folder can be moved or deleted"
			Pop $portableRadioPortable
		${EndIf}
		${If} $portableMode == 1
			${NSD_Check} $portableRadioPortable
		${Else}
			${NSD_Check} $portableRadioNormal
		${EndIf}
		nsDialogs::Show
	FunctionEnd

	Function portablePageLeave
		${NSD_GetState} $portableRadioPortable $portableMode
	FunctionEnd
!macroend

; Портативная установка: убираем всё, что связывает программу с системой, и ставим метку, по которой программа хранит данные рядом с собой
!macro customInstall
	${If} $portableMode == 1
		Delete "$newStartMenuLink"
		Delete "$newDesktopLink"
		Delete "$INSTDIR\${UNINSTALL_FILENAME}"
		DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
		DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"
		FileOpen $0 "$INSTDIR\portable.txt" w
		FileWrite $0 "Портативная установка Problet: данные хранятся в папке data рядом с программой.$\r$\n"
		FileClose $0
		StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
	${EndIf}
!macroend
