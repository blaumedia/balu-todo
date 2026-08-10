// Task attachments on mobile (contract §3.7). The list renders from the synced
// metadata and therefore works offline; the bytes are fetched on demand.
import {
  attachmentsForTask,
  formatFileSize,
  isImageAttachment,
  type Attachment,
} from '@balu/domain';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import { deleteAttachment } from '../lib/actions';
import {
  cachedUri,
  downloadAttachment,
  evictAttachment,
  uploadAttachment,
  type RnFile,
} from '../lib/attachments';
import { getSync } from '../lib/clients';
import { useApp } from '../store/app';
import { useTheme } from '../theme/ThemeProvider';
import type { useSnapshot } from '../store/useSnapshot';
import { font, radius, space } from '../theme/tokens';

const THUMB = 72;

export function AttachmentsSection({
  taskId,
  snap,
  writable,
}: {
  taskId: string;
  snap: ReturnType<typeof useSnapshot>;
  writable: boolean;
}) {
  const theme = useTheme();
  const { t } = useT();
  const workspaceId = useApp((s) => s.workspace?.id) ?? null;

  const attachments = attachmentsForTask(snap.attachments, taskId);
  const images = attachments.filter(isImageAttachment);
  const files = attachments.filter((a) => !isImageAttachment(a));

  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const confirmRemove = useCallback(
    (a: Attachment) => {
      Alert.alert(t('attachment.deleteConfirm'), a.filename, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            deleteAttachment(a.id);
            evictAttachment(a); // the local copy now points at nothing
          },
        },
      ]);
    },
    [t],
  );

  async function send(file: RnFile) {
    if (!workspaceId) return;
    setUploading(true);
    try {
      await uploadAttachment(workspaceId, taskId, file);
      // There is no attachment_add command to apply optimistically, so the row
      // only exists once it has been pulled.
      await getSync()?.sync();
    } catch {
      Alert.alert(t('attachment.uploadError'));
    } finally {
      setUploading(false);
    }
  }

  async function pickPhoto() {
    // The picker prompts for permission itself; a denial resolves as canceled,
    // which is exactly the "silently return" we want.
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    await send({
      uri: asset.uri,
      name: asset.fileName ?? 'photo.jpg',
      type: asset.mimeType ?? 'image/jpeg',
    });
  }

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    await send({
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? 'application/octet-stream',
    });
  }

  function promptAdd() {
    Alert.alert(t('attachment.add'), undefined, [
      { text: t('attachment.photo'), onPress: () => void pickPhoto() },
      { text: t('attachment.file'), onPress: () => void pickFile() },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  async function openFile(a: Attachment) {
    if (!workspaceId) return;
    const uri = await downloadAttachment(workspaceId, a);
    if (!uri) {
      Alert.alert(t('attachment.downloadError'));
      return;
    }
    // No `UTI`: that field wants an Apple uniform-type identifier, not a MIME
    // type, and a wrong one is worse than none (the cached file carries the
    // original extension, which is what iOS actually reads).
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: a.content_type });
    }
  }

  return (
    <View style={[styles.section, { borderTopColor: theme.border }]}>
      <View style={styles.header}>
        <Icon name="paperclip" size={16} color={theme.textTertiary} strokeWidth={2} />
        <Text style={[styles.title, { color: theme.textSecondary }]}>{t('attachment.title')}</Text>
        {attachments.length > 0 ? (
          <Text style={[styles.count, { color: theme.textTertiary }]}>{attachments.length}</Text>
        ) : null}
      </View>

      {images.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
          {images.map((a) => (
            <Thumbnail
              key={a.id}
              attachment={a}
              workspaceId={workspaceId}
              writable={writable}
              onPress={(uri) => setLightbox(uri)}
              onRemove={() => confirmRemove(a)}
              removeLabel={t('attachment.delete')}
            />
          ))}
        </ScrollView>
      ) : null}

      {files.map((a) => (
        <View key={a.id} style={styles.fileRow}>
          <Pressable style={styles.filePress} onPress={() => void openFile(a)}>
            <Icon name="file-text" size={18} color={theme.textTertiary} strokeWidth={2} />
            <Text style={[styles.fileName, { color: theme.textPrimary }]} numberOfLines={1}>
              {a.filename}
            </Text>
            <Text style={[styles.fileSize, { color: theme.textTertiary }]}>
              {formatFileSize(a.size_bytes)}
            </Text>
          </Pressable>
          {writable ? (
            <Pressable
              onPress={() => confirmRemove(a)}
              hitSlop={10}
              accessibilityLabel={t('attachment.delete')}
            >
              <Icon name="x" size={16} color={theme.textTertiary} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
      ))}

      {writable ? (
        <Pressable style={styles.addRow} onPress={promptAdd} disabled={uploading}>
          {uploading ? (
            <ActivityIndicator size="small" color={theme.accent} />
          ) : (
            <Icon name="plus" size={18} color={theme.accent} strokeWidth={2} />
          )}
          <Text style={[styles.addText, { color: uploading ? theme.textTertiary : theme.accent }]}>
            {t('attachment.add')}
          </Text>
        </Pressable>
      ) : null}

      <Modal visible={lightbox != null} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <Pressable style={styles.backdrop} onPress={() => setLightbox(null)}>
          {lightbox ? <Image source={{ uri: lightbox }} style={styles.full} resizeMode="contain" /> : null}
          <Pressable
            style={styles.close}
            onPress={() => setLightbox(null)}
            hitSlop={12}
            accessibilityLabel={t('common.cancel')}
          >
            <Icon name="x" size={24} color="#fff" strokeWidth={2} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Thumbnail({
  attachment,
  workspaceId,
  writable,
  onPress,
  onRemove,
  removeLabel,
}: {
  attachment: Attachment;
  workspaceId: string | null;
  writable: boolean;
  onPress: (uri: string) => void;
  onRemove: () => void;
  removeLabel: string;
}) {
  const theme = useTheme();
  const [uri, setUri] = useState<string | null>(cachedUri(attachment.id) ?? null);

  useEffect(() => {
    if (uri || !workspaceId) return;
    let alive = true;
    void downloadAttachment(workspaceId, attachment).then((local) => {
      if (local && alive) setUri(local);
    });
    return () => {
      alive = false;
    };
  }, [uri, workspaceId, attachment.id]);

  return (
    <View>
      <Pressable
        onPress={() => uri && onPress(uri)}
        style={[styles.thumb, { borderColor: theme.border, backgroundColor: theme.surfaceRaised }]}
        accessibilityLabel={attachment.filename}
      >
        {uri ? (
          <Image source={{ uri }} style={styles.thumbImage} resizeMode="cover" />
        ) : (
          // Neutral placeholder while the download runs (or after it failed).
          <ActivityIndicator size="small" color={theme.textTertiary} />
        )}
      </Pressable>
      {writable ? (
        <Pressable
          style={[styles.thumbRemove, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={removeLabel}
        >
          <Icon name="x" size={12} color={theme.textSecondary} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: space.s5, borderTopWidth: StyleSheet.hairlineWidth, marginTop: space.s4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingBottom: space.s3 },
  title: { fontSize: font.secondary, fontWeight: font.weightSemibold },
  count: { fontSize: font.caption, fontVariant: ['tabular-nums'] },
  thumbRow: { gap: space.s2, paddingBottom: space.s3, paddingRight: space.s2 },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImage: { width: '100%', height: '100%' },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingVertical: space.s1 },
  filePress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingVertical: space.s2 },
  fileName: { flex: 1, fontSize: font.secondary },
  fileSize: { fontSize: font.caption, fontVariant: ['tabular-nums'] },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingVertical: space.s3 },
  addText: { fontSize: font.secondary, fontWeight: font.weightMedium },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  full: { width: '100%', height: '100%' },
  close: { position: 'absolute', top: 48, right: 20 },
});
