import 'package:flutter/material.dart';
import '../models/soap_recommendation.dart';

const _bgRaised = Color(0xFF1A1E26);
const _bgSurface = Color(0xFF242A36);
const _coral = Color(0xFFE8998D);
const _teal = Color(0xFF5EEAD4);
const _text = Color(0xFFF5F3F0);
const _textMuted = Color(0xFF8B92A0);

class SoapRecommendationCard extends StatelessWidget {
  final SoapRecommendation recommendation;
  final String serverHost;

  const SoapRecommendationCard({
    super.key,
    required this.recommendation,
    required this.serverHost,
  });

  String get _imageUrl {
    String host = serverHost.trim();
    if (!host.startsWith('http://') && !host.startsWith('https://')) {
      final isSecure = host.contains('ngrok') || host.contains('loca.lt');
      host = (isSecure ? 'https://' : 'http://') + host;
    }
    host = host.replaceAll(RegExp(r'/$'), '');
    return '$host/soaps/${recommendation.soap.imageAsset}';
  }

  @override
  Widget build(BuildContext context) {
    final soap = recommendation.soap;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: _bgRaised,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Image header
          Stack(
            children: [
              AspectRatio(
                aspectRatio: 16 / 9,
                child: Image.network(
                  _imageUrl,
                  fit: BoxFit.cover,
                  errorBuilder: (context, error, stackTrace) => Container(
                    color: _bgSurface,
                    child: const Center(
                      child: Icon(Icons.clean_hands, color: _textMuted, size: 36),
                    ),
                  ),
                ),
              ),
              if (soap.isPhotosensitizing)
                Positioned(
                  top: 8,
                  right: 8,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: _coral.withValues(alpha: 0.9),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('☀️ PM / SPF Caution',
                            style: TextStyle(
                              color: Colors.black,
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                            )),
                      ],
                    ),
                  ),
                ),
            ],
          ),

          // Content
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(
                        soap.nameEn,
                        style: const TextStyle(
                          color: _text,
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    Text(
                      soap.nameAr,
                      style: const TextStyle(
                        color: _textMuted,
                        fontSize: 14,
                        fontFamily: 'sans-serif',
                      ),
                      textDirection: TextDirection.rtl,
                    ),
                  ],
                ),
                const SizedBox(height: 8),

                Text(
                  recommendation.reasoning,
                  style: const TextStyle(color: _text, fontSize: 13, height: 1.4),
                ),
                const SizedBox(height: 12),

                if (soap.keyActives.isNotEmpty) ...[
                  const Text(
                    'KEY ACTIVES',
                    style: TextStyle(
                      color: _textMuted,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: soap.keyActives
                        .map(
                          (active) => Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: _bgSurface,
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                            ),
                            child: Text(
                              active,
                              style: const TextStyle(color: _teal, fontSize: 11),
                            ),
                          ),
                        )
                        .toList(),
                  ),
                  const SizedBox(height: 10),
                ],

                if (soap.cautions.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: _coral.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: _coral.withValues(alpha: 0.3)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: soap.cautions
                          .map(
                            (caution) => Padding(
                              padding: const EdgeInsets.only(bottom: 2),
                              child: Text(
                                '⚠️ $caution',
                                style: const TextStyle(color: _coral, fontSize: 11, height: 1.3),
                              ),
                            ),
                          )
                          .toList(),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
