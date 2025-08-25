const { createApp } = Vue;

createApp({
    data() {
        return {
            appTitle: '촬영 체크리스트',
            editingTitle: false,
            tempTitle: '',
            showModal: false,
            showTrashModal: false,
            showDescriptionModal: false,
            showStorageModal: false,
            showPresetModal: false,
            showHelpModal: false,
            showMenu: false,
            modalMode: 'add', // 'add' or 'edit'
            modalData: { text: '', description: '' },
            editingItem: null,
            selectedItem: null,
            showNumbers: false,
            isDarkMode: false,
            uiLocked: false,
            trashItems: [], // 삭제된 항목들
            storageItems: [], // 보관된 항목들
            presets: {}, // 프리셋 저장소
            selectedPresetSlot: null, // 선택된 프리셋 슬롯
            sortableInstance: null,
            activeActions: null,
            actionTimeout: null,
            hoverTimeout: null,
            photoList: [
                { id: 1, text: '신랑신부 포즈컷', description: '', completed: false },
                { id: 2, text: '신부 포즈컷', description: '', completed: false },
                { id: 3, text: '신랑신부 정면', description: '', completed: false },
                { id: 4, text: '양가 혼주', description: '', completed: false },
                { id: 5, text: '가족 친척 전체', description: '', completed: false },
                { id: 6, text: '신랑측 직계가족', description: '', completed: false },
                { id: 7, text: '신부측 직계가족', description: '', completed: false },
                { id: 8, text: '직장동료 우인', description: '', completed: false },
                { id: 9, text: '부케 던지기', description: '', completed: false },
                { id: 10, text: '플래시 컷', description: '', completed: false }
            ],
            nextId: 11
        }
    },
    
    computed: {
        modalTitle() {
            return this.modalMode === 'add' ? '새 촬영 항목 추가' : '항목 수정';
        }
    },
    
    watch: {
        photoList: {
            handler() {
                this.saveToStorage();
            },
            deep: true
        },
        trashItems: {
            handler() {
                this.saveToStorage();
            },
            deep: true
        },
        storageItems: {
            handler() {
                this.saveToStorage();
            },
            deep: true
        },
        
        isDarkMode() {
            this.saveToStorage();
            this.applyTheme();
        },
        appTitle() {
            this.saveToStorage();
        }
    },
    
    mounted() {
        this.loadFromStorage();
        this.loadPresets();
        this.initializeTheme();
        this.initSortable();
        
        // 메뉴 외부 클릭 시 닫기
        document.addEventListener('click', this.handleOutsideClick);
    },
    
    methods: {
        // 항목 추가 관련
        showAddInput() {
            if (this.uiLocked) return;
            this.modalMode = 'add';
            this.modalData = { text: '', description: '' };
            this.editingItem = null;
            this.showModal = true;
            this.$nextTick(() => {
                if (this.$refs.modalTitleInput) {
                    this.$refs.modalTitleInput.focus();
                }
            });
        },

        startEdit(item) {
            if (this.uiLocked) return;
            this.modalMode = 'edit';
            this.modalData = { 
                text: item.text, 
                description: item.description || '' 
            };
            this.editingItem = item;
            this.showModal = true;
            this.$nextTick(() => {
                if (this.$refs.modalTitleInput) {
                    this.$refs.modalTitleInput.focus();
                    this.$refs.modalTitleInput.select();
                }
            });
        },

        cancelModal() {
            this.showModal = false;
            this.modalData = { text: '', description: '' };
            this.editingItem = null;
        },

        saveModal() {
            if (!this.modalData.text.trim()) return;
            
            if (this.modalMode === 'add') {
                this.photoList.push({
                    id: this.nextId++,
                    text: this.modalData.text.trim(),
                    description: this.modalData.description.trim(),
                    completed: false
                });
            } else if (this.editingItem) {
                this.editingItem.text = this.modalData.text.trim();
                this.editingItem.description = this.modalData.description.trim();
            }
            
            this.cancelModal();
        },

        // 체크박스 토글
        toggleComplete(item) {
            item.completed = !item.completed;
            try { this.saveToStorage && this.saveToStorage(); } catch (e) {}
        },

        // UI 제어
        toggleTheme() {
            this.isDarkMode = !this.isDarkMode;
            this._themeAutoFollow = false; // 사용자가 수동으로 변경함을 기록
            this.showMenu = false;
        },

        applyTheme() {
            if (this.isDarkMode) {
                document.documentElement.setAttribute('data-theme', 'dark');
            } else {
                document.documentElement.removeAttribute('data-theme');
            }
        },
        
        initializeTheme() {
            // 저장된 테마가 없다면 시스템 설정 확인
            if (this._currentData === undefined) {
                const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                this.isDarkMode = prefersDark;
            }
            this.applyTheme();
            
            // 시스템 테마 변경 감지
            if (window.matchMedia) {
                const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
                mediaQuery.addListener((e) => {
                    // 사용자가 수동으로 테마를 변경하지 않은 경우에만 시스템 테마 따라가기
                    if (this._themeAutoFollow !== false) {
                        this.isDarkMode = e.matches;
                    }
                });
            }
        },

        toggleUILock() {
            this.uiLocked = !this.uiLocked;
            if (this.uiLocked && this.sortableInstance) {
                this.sortableInstance.option('disabled', true);
            } else if (this.sortableInstance) {
                this.sortableInstance.option('disabled', false);
            }
            this.showMenu = false;
        },

        // 항목 액션 버튼 제어
        showItemActions(itemId) {
            if (this.uiLocked) return;
            
            this.clearActionTimeout();
            this.activeActions = itemId;
            
            // 3초 후 자동으로 숨김
            this.actionTimeout = setTimeout(() => {
                this.activeActions = null;
            }, 3000);
        },

        showItemActionsOnHover(itemId) {
            if (this.uiLocked) return;
            
            this.clearHoverTimeout();
            this.activeActions = itemId;
        },

        hideItemActionsOnHover(itemId) {
            if (this.uiLocked) return;
            
            // 마우스가 벗어나면 약간의 딜레이 후 숨김
            this.hoverTimeout = setTimeout(() => {
                if (this.activeActions === itemId) {
                    this.activeActions = null;
                }
            }, 300);
        },

        clearActionTimeout() {
            if (this.actionTimeout) {
                clearTimeout(this.actionTimeout);
                this.actionTimeout = null;
            }
        },

        clearHoverTimeout() {
            if (this.hoverTimeout) {
                clearTimeout(this.hoverTimeout);
                this.hoverTimeout = null;
            }
        },

        // 특이사항 팝업
        showDescriptionPopup(item) {
            this.selectedItem = item;
            this.showDescriptionModal = true;
        },

        closeDescriptionPopup() {
            this.showDescriptionModal = false;
            this.selectedItem = null;
        },

        // 보관소 관련
        moveToStorage(id) {
            if (this.uiLocked) return;
            
            // 액션 버튼 숨김
            this.activeActions = null;
            this.clearActionTimeout();
            this.clearHoverTimeout();
            
            const item = this.photoList.find(item => item.id === id);
            if (!item) return;
            
            // 보관소 버튼 ripple 애니메이션
            const storageBtn = document.querySelector('.storage-btn');
            if (storageBtn) {
                document.body.style.overflow = 'hidden';
                
                storageBtn.classList.add('ripple');
                setTimeout(() => {
                    storageBtn.classList.remove('ripple');
                    document.body.style.overflow = '';
                }, 2400);
            }
            
            // 애니메이션을 위해 요소에 클래스 추가
            const element = document.querySelector(`[data-id="${id}"]`);
            if (element) {
                element.classList.add('item-deleting');
                
                // 애니메이션 완료 후 실제 이동
                setTimeout(() => {
                    // 보관소에 추가
                    this.storageItems.unshift({
                        ...item,
                        storedAt: new Date().toISOString()
                    });
                    
                    // 리스트에서 제거
                    this.photoList = this.photoList.filter(item => item.id !== id);
                }, 500);
            } else {
                // 애니메이션이 불가능한 경우 즉시 처리
                this.storageItems.unshift({
                    ...item,
                    storedAt: new Date().toISOString()
                });
                this.photoList = this.photoList.filter(item => item.id !== id);
            }
        },

        openStorageModal() {
            this.showStorageModal = true;
        },

        closeStorageModal() {
            this.showStorageModal = false;
        },

        restoreFromStorage(storageItem) {
            // 보관소에서 제거
            this.storageItems = this.storageItems.filter(item => item.id !== storageItem.id);
            
            // 리스트 맨 아래에 추가
            const restoredItem = {
                id: storageItem.id,
                text: storageItem.text,
                description: storageItem.description,
                completed: false // 복구시 체크 해제 상태로
            };
            
            this.photoList.push(restoredItem);
            
            // 짧은 피드백
            const element = document.querySelector(`[data-id="${storageItem.id}"]`);
            if (element) {
                element.style.animation = 'fadeIn 0.5s ease';
            }
        },

        // 휴지통 관련
        moveAllFromTrashToStorage() {
            if (this.trashItems.length === 0) return;
            
            // 모든 휴지통 항목을 보관소로 이동
            this.trashItems.forEach(item => {
                this.storageItems.unshift({
                    ...item,
                    storedAt: new Date().toISOString()
                });
            });
            
            // 휴지통 비우기
            this.trashItems = [];
            this.closeTrashModal();
        },

        removeItem(id) {
            if (this.uiLocked) return;
            
            // 액션 버튼 숨김
            this.activeActions = null;
            this.clearActionTimeout();
            this.clearHoverTimeout();
            
            const item = this.photoList.find(item => item.id === id);
            if (!item) return;
            
            // 휴지통 버튼 ripple 애니메이션
            const trashBtn = document.querySelector('.trash-btn');
            if (trashBtn) {
                document.body.style.overflow = 'hidden';
                
                trashBtn.classList.add('ripple');
                setTimeout(() => {
                    trashBtn.classList.remove('ripple');
                    document.body.style.overflow = '';
                }, 2400);
            }
            
            // 애니메이션을 위해 요소에 클래스 추가
            const element = document.querySelector(`[data-id="${id}"]`);
            if (element) {
                element.classList.add('item-deleting');
                
                // 애니메이션 완료 후 실제 삭제
                setTimeout(() => {
                    // 휴지통에 추가
                    this.trashItems.unshift({
                        ...item,
                        deletedAt: new Date().toISOString()
                    });
                    
                    // 리스트에서 제거
                    this.photoList = this.photoList.filter(item => item.id !== id);
                }, 500);
            } else {
                // 애니메이션이 불가능한 경우 즉시 처리
                this.trashItems.unshift({
                    ...item,
                    deletedAt: new Date().toISOString()
                });
                this.photoList = this.photoList.filter(item => item.id !== id);
            }
        },

        openTrashModal() {
            this.showTrashModal = true;
        },

        closeTrashModal() {
            this.showTrashModal = false;
        },

        restoreItem(trashItem) {
            // 휴지통에서 제거
            this.trashItems = this.trashItems.filter(item => item.id !== trashItem.id);
            
            // 리스트 맨 아래에 추가
            const restoredItem = {
                id: trashItem.id,
                text: trashItem.text,
                description: trashItem.description,
                completed: false // 복구시 체크 해제 상태로
            };
            
            this.photoList.push(restoredItem);
            
            // 짧은 피드백
            const element = document.querySelector(`[data-id="${trashItem.id}"]`);
            if (element) {
                element.style.animation = 'fadeIn 0.5s ease';
            }
        },

        clearTrash() {
            if (confirm(`휴지통의 모든 항목(${this.trashItems.length}개)을 영구 삭제하시겠습니까?`)) {
                this.trashItems = [];
                this.closeTrashModal();
            }
        },

        // 모달 제어
        closeAllModals() {
            this.showModal = false;
            this.showTrashModal = false;
            this.showDescriptionModal = false;
            this.showStorageModal = false;
            this.showPresetModal = false;
            this.showHelpModal = false;
            this.showMenu = false;
            this.selectedItem = null;
            this.selectedPresetSlot = null;
        },

        // 메뉴 제어
        toggleMenu() {
            this.showMenu = !this.showMenu;
        },

        handleOutsideClick(event) {
            if (this.showMenu) {
                const menuButton = this.$refs.menuButton;
                const dropdownMenu = document.querySelector('.dropdown-menu');
                
                if (menuButton && !menuButton.contains(event.target) && 
                    dropdownMenu && !dropdownMenu.contains(event.target)) {
                    this.showMenu = false;
                }
            }
        },

        // 프리셋 관련
        openPresetModal() {
            this.showPresetModal = true;
            this.showMenu = false;
        },

        closePresetModal() {
            this.showPresetModal = false;
            this.selectedPresetSlot = null;
        },

        selectPresetSlot(slot) {
            this.selectedPresetSlot = slot;
        },

        savePreset() {
            if (!this.selectedPresetSlot) return;
            
            const slotNumber = this.selectedPresetSlot; // 슬롯 번호 미리 저장
            const presetData = {
                title: this.appTitle,
                photoList: JSON.parse(JSON.stringify(this.photoList)),
                trashItems: JSON.parse(JSON.stringify(this.trashItems)),
                storageItems: JSON.parse(JSON.stringify(this.storageItems)),
                nextId: this.nextId,
isDarkMode: this.isDarkMode,
                themeAutoFollow: this._themeAutoFollow,
                savedAt: new Date().toISOString()
            };
            
            this.presets[this.selectedPresetSlot] = presetData;
            this.savePresets();
            alert(`프리셋 ${slotNumber}에 저장되었습니다.`);
        },

        loadPreset() {
            if (!this.selectedPresetSlot || !this.presets[this.selectedPresetSlot]) return;
            
            const slotNumber = this.selectedPresetSlot; // 슬롯 번호 미리 저장
            const preset = this.presets[this.selectedPresetSlot];
            this.appTitle = preset.title;
            this.photoList = JSON.parse(JSON.stringify(preset.photoList));
            this.trashItems = JSON.parse(JSON.stringify(preset.trashItems));
            this.storageItems = JSON.parse(JSON.stringify(preset.storageItems));
            this.nextId = preset.nextId;
            this.isDarkMode = preset.isDarkMode !== undefined ? preset.isDarkMode : false;
            this._themeAutoFollow = preset.themeAutoFollow !== undefined ? preset.themeAutoFollow : false;
            
            this.closePresetModal();
            alert(`프리셋 ${slotNumber}을 불러왔습니다.`);
        },

        clearPreset() {
            if (!this.selectedPresetSlot || !this.presets[this.selectedPresetSlot]) return;
            
            const slotNumber = this.selectedPresetSlot; // 슬롯 번호 미리 저장
            if (confirm(`프리셋 ${slotNumber}을 삭제하시겠습니까?`)) {
                delete this.presets[this.selectedPresetSlot];
                this.savePresets();
                this.selectedPresetSlot = null;
                alert('프리셋이 삭제되었습니다.');
            }
        },

        // 도움말
        openHelpModal() {
            this.showHelpModal = true;
            this.showMenu = false;
        },

        closeHelpModal() {
            this.showHelpModal = false;
        },

        // 기타 유틸리티
        resetAll() {
            this.photoList.forEach(item => {
                item.completed = false;
            });
            this.showMenu = false;
        },

        // 제목 편집
        startEditTitle() {
            if (this.uiLocked) return;
            this.editingTitle = true;
            this.tempTitle = this.appTitle;
            this.$nextTick(() => {
                if (this.$refs.titleInput) {
                    this.$refs.titleInput.focus();
                    this.$refs.titleInput.select();
                }
            });
        },

        saveTitle() {
            if (this.tempTitle.trim()) {
                this.appTitle = this.tempTitle.trim();
            }
            this.editingTitle = false;
            this.tempTitle = '';
        },

        cancelEditTitle() {
            this.editingTitle = false;
            this.tempTitle = '';
        },

        // 데이터 저장/로드
        saveToStorage() {
    try {
        const data = {
            appTitle: this.appTitle,
            photoList: this.photoList,
            trashItems: this.trashItems,
            storageItems: this.storageItems,
            nextId: this.nextId,
isDarkMode: this.isDarkMode,
            themeAutoFollow: this._themeAutoFollow,
            lastSaved: new Date().toISOString()
        };
        localStorage.setItem('kpagChecklist:state', JSON.stringify(data));
        this._currentData = JSON.stringify(data); // fallback 유지
    } catch (error) {
        console.warn('현재 상태 저장 실패:', error);
    }
},

        loadFromStorage() {
    try {
        const raw = localStorage.getItem('kpagChecklist:state') || this._currentData || null;
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') {
            this.appTitle = data.appTitle || this.appTitle || '촬영 체크리스트';
            this.photoList = Array.isArray(data.photoList) ? data.photoList : this.photoList;
            this.trashItems = Array.isArray(data.trashItems) ? data.trashItems : this.trashItems;
            this.storageItems = Array.isArray(data.storageItems) ? data.storageItems : this.storageItems;
            this.nextId = typeof data.nextId === 'number' ? data.nextId : this.nextId;
            this.isDarkMode = typeof data.isDarkMode === 'boolean' ? data.isDarkMode : this.isDarkMode;
            this._themeAutoFollow = typeof data.themeAutoFollow === 'boolean' ? data.themeAutoFollow : this._themeAutoFollow;
        }
    } catch (error) {
        console.warn('현재 상태 로드 실패:', error);
    }
},

        savePresets() {
    try {
        localStorage.setItem('kpagChecklist:presets', JSON.stringify(this.presets));
        this._presets = JSON.stringify(this.presets); // fallback 유지
    } catch (error) {
        console.warn('프리셋 저장 실패:', error);
    }
},

        loadPresets() {
    try {
        const raw = localStorage.getItem('kpagChecklist:presets') || this._presets || null;
        if (raw) this.presets = JSON.parse(raw);
    } catch (error) {
        console.warn('프리셋 로드 실패:', error);
    }
},

        // 드래그 앤 드롭 초기화
        initSortable() {
            const el = this.$refs.photoListEl;
            if (el && typeof Sortable !== 'undefined') {
                if (this.sortableInstance) {
                    this.sortableInstance.destroy();
                }
                
                this.sortableInstance = new Sortable(el, {
                    animation: 150,
                    ghostClass: 'sortable-ghost',
                    forceFallback: true,
                    fallbackTolerance: 3,
                    touchStartThreshold: 10,
                    delay: 100,
                    delayOnTouchStart: true,
                    onStart: function() {
                        document.body.style.overflow = 'hidden';
                    },
                    onEnd: (evt) => {
                        document.body.style.overflow = '';
                        const item = this.photoList.splice(evt.oldIndex, 1)[0];
                        this.photoList.splice(evt.newIndex, 0, item);
                    }
                });
            }
        }
    },

    // 컴포넌트 언마운트 시 정리
    beforeUnmount() {
        if (this.sortableInstance) {
            this.sortableInstance.destroy();
        }
        this.clearActionTimeout();
        this.clearHoverTimeout();
        document.removeEventListener('click', this.handleOutsideClick);
    }
}).mount('#app');