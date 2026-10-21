APP := build/TrashHelper.app
INSTALL_APP := /usr/local/libexec/TrashHelper.app

.PHONY: build test install
build: $(APP)/Contents/_CodeSignature/CodeResources

$(APP)/Contents/_CodeSignature/CodeResources: main.m Info.plist entitlements.plist
	mkdir -p $(APP)/Contents/MacOS
	xcrun clang -Wall -Wextra -Werror -O2 -framework Cocoa -framework Carbon main.m -o $(APP)/Contents/MacOS/trash-helper
	install -m 644 Info.plist $(APP)/Contents/Info.plist
	codesign --force --sign - --options runtime --entitlements entitlements.plist $(APP)

test: build
	bash test.sh

install:
	test "$$(id -u)" = 0
	if test -e $(INSTALL_APP); then \
		codesign --verify --strict $(INSTALL_APP) && \
		cmp $(APP)/Contents/MacOS/trash-helper $(INSTALL_APP)/Contents/MacOS/trash-helper && \
		cmp $(APP)/Contents/Info.plist $(INSTALL_APP)/Contents/Info.plist && \
		cmp $(APP)/Contents/_CodeSignature/CodeResources $(INSTALL_APP)/Contents/_CodeSignature/CodeResources; \
	fi
	codesign --verify --strict $(APP)
	install -d -o root -g wheel -m 755 /usr/local/bin /usr/local/libexec $(INSTALL_APP)/Contents/MacOS $(INSTALL_APP)/Contents/_CodeSignature
	install -o root -g wheel -m 755 $(APP)/Contents/MacOS/trash-helper $(INSTALL_APP)/Contents/MacOS/trash-helper
	install -o root -g wheel -m 644 $(APP)/Contents/Info.plist $(INSTALL_APP)/Contents/Info.plist
	install -o root -g wheel -m 644 $(APP)/Contents/_CodeSignature/CodeResources $(INSTALL_APP)/Contents/_CodeSignature/CodeResources
	install -o root -g wheel -m 755 empty-trash /usr/local/bin/empty-trash
	codesign --verify --strict $(INSTALL_APP)
