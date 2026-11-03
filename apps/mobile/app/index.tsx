import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { t } from '@yapesa/i18n';
import { tokens } from '@yapesa/ui-tokens';
export default function Home() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.page}>
          <Text style={styles.eyebrow}>{t('phase')}</Text>
          <Text style={styles.title}>{t('appName')}</Text>
          <Text style={styles.tagline}>{t('tagline')}</Text>
          <View style={styles.card}>
            <Text style={styles.heading}>{t('status')}</Text>
            <Text>{t('next')}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: tokens.color.background },
  page: { padding: tokens.space.large, paddingTop: 64 },
  eyebrow: { color: tokens.color.accent, fontWeight: '700' },
  title: {
    color: tokens.color.ink,
    fontSize: 48,
    fontWeight: '700',
    marginVertical: 16,
  },
  tagline: { color: tokens.color.muted, fontSize: 20, lineHeight: 30 },
  card: {
    backgroundColor: tokens.color.surface,
    padding: 24,
    borderRadius: 16,
    marginTop: 40,
    gap: 16,
  },
  heading: { color: tokens.color.ink, fontSize: 18, fontWeight: '600' },
});
