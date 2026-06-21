#include "asterix_decoder.h"
#include <cstring>
#include <vector>

namespace asterix {

static std::vector<uint8_t> parseFSPEC(BitReader& br) {
    std::vector<uint8_t> fspec;
    while (true) {
        uint8_t octet = static_cast<uint8_t>(br.readBits(8));
        fspec.push_back(octet);
        if (!(octet & 0x01)) break;
    }
    return fspec;
}

static bool fspecHasItem(const std::vector<uint8_t>& fspec, size_t frn) {
    if (frn == 0) return false;
    size_t octet_idx = (frn - 1) / 7;
    size_t bit_idx = 7 - ((frn - 1) % 7);
    if (octet_idx >= fspec.size()) return false;
    return (fspec[octet_idx] & (1 << bit_idx)) != 0;
}

std::vector<TrackPoint> decodeCat048(const uint8_t* data, size_t len, const RadarSource& radar) {
    std::vector<TrackPoint> result;
    if (len < 5) return result;

    BitReader br(data + 1, len - 1);

    uint16_t len_field = br.readU16(16);
    if (len_field > len) return result;

    while (!br.eof()) {
        size_t record_start = br.bytePos();

        std::vector<uint8_t> fspec = parseFSPEC(br);

        TrackPoint tp{};
        tp.has_mode_s = false;
        tp.has_position = false;
        tp.has_altitude = false;
        tp.ground_speed = 0;
        tp.track_angle = 0;

        if (fspecHasItem(fspec, 1)) {
            uint8_t ds = br.readU8(4);
            uint8_t sp = br.readU8(4);
        }

        if (fspecHasItem(fspec, 2)) {
            tp.mode_s_address = br.readU32(24);
            tp.has_mode_s = true;
        }

        if (fspecHasItem(fspec, 3)) {
            tp.time_of_day = static_cast<double>(br.readU32(24)) / 128.0;
        }

        if (fspecHasItem(fspec, 4)) {
            uint32_t code = br.readU32(16);
            uint8_t a4 = (code >> 12) & 0x07;
            uint8_t a3 = (code >> 8) & 0x07;
            uint8_t a2 = (code >> 4) & 0x07;
            uint8_t a1 = code & 0x07;
            tp.track_number = a1 * 1000 + a2 * 100 + a3 * 10 + a4;
        }

        double rho_m = 0.0;
        double theta_deg = 0.0;
        bool has_rho = false;
        bool has_theta = false;

        if (fspecHasItem(fspec, 5)) {
            rho_m = static_cast<double>(br.readU16(16)) * (1.0 / 32.0) * 1852.0;
            has_rho = true;
        }

        if (fspecHasItem(fspec, 6)) {
            theta_deg = static_cast<double>(br.readU16(16)) * 360.0 / 65536.0;
            has_theta = true;
        }

        if (has_rho && has_theta) {
            wgs84DistanceBearingToLat(radar.radar_lat, radar.radar_lon, rho_m, theta_deg,
                                      tp.latitude, tp.longitude);
            tp.has_position = true;
        }

        if (fspecHasItem(fspec, 7)) {
            uint32_t alt_code = br.readU32(16);
            if (alt_code & 0x0040) {
                uint32_t num = ((alt_code & 0x001F) << 8) | ((alt_code & 0x0F00) >> 4) |
                               ((alt_code & 0x0020) << 5) | ((alt_code & 0xE000) >> 7);
                int32_t feet = static_cast<int32_t>(num) * 100 - 1200;
                tp.altitude_fl = static_cast<double>(feet) / 100.0;
                tp.has_altitude = true;
            } else {
                uint32_t num = ((alt_code & 0x0010) << 4) | ((alt_code & 0x000F) << 2) |
                               ((alt_code & 0x0080) >> 6) | ((alt_code & 0x0020) >> 5) |
                               ((alt_code & 0x0F00) >> 8) | ((alt_code & 0xE000) >> 11);
                int32_t metric = static_cast<int32_t>(num) * 25;
                tp.altitude_fl = static_cast<double>(metric) / 30.48 / 100.0;
                tp.has_altitude = true;
            }
        }

        if (fspecHasItem(fspec, 8)) {
            br.skipBits(8);
        }

        if (fspecHasItem(fspec, 9)) {
            uint8_t fs = br.readU8(3);
            uint8_t ps = br.readU8(2);
            br.skipBits(1);
            uint8_t ss = br.readU8(2);
        }

        if (fspecHasItem(fspec, 10)) {
            uint16_t gs_raw = br.readU16(16);
            if (gs_raw > 16383) {
                tp.ground_speed = 0;
            } else {
                tp.ground_speed = static_cast<double>(gs_raw) * 0.1;
            }
        }

        if (fspecHasItem(fspec, 11)) {
            uint16_t hdg_raw = br.readU16(16);
            tp.track_angle = static_cast<double>(hdg_raw) * 360.0 / 65536.0;
        }

        if (fspecHasItem(fspec, 13)) {
            uint8_t ri = br.readU8(8);
        }

        if (fspecHasItem(fspec, 16)) {
            br.skipBits(8);
        }

        if (fspecHasItem(fspec, 17)) {
            br.skipBits(32);
        }

        if (fspecHasItem(fspec, 20)) {
            uint8_t c1 = br.readU8(6);
            uint8_t c2 = br.readU8(6);
            uint8_t c3 = br.readU8(6);
            uint8_t c4 = br.readU8(6);
            uint8_t c5 = br.readU8(6);
            uint8_t c6 = br.readU8(6);
            uint8_t c7 = br.readU8(6);
            uint8_t c8 = br.readU8(6);
            char cs[9] = {0};
            uint8_t arr[8] = {c1, c2, c3, c4, c5, c6, c7, c8};
            for (int i = 0; i < 8; i++) {
                if (arr[i] == 32) cs[i] = ' ';
                else if (arr[i] >= 1 && arr[i] <= 26) cs[i] = 'A' + arr[i] - 1;
                else if (arr[i] >= 48 && arr[i] <= 57) cs[i] = '0' + (arr[i] - 48);
                else cs[i] = ' ';
            }
            tp.callsign = std::string(cs);
        }

        if (fspecHasItem(fspec, 23)) {
            br.skipBits(8);
        }

        if (fspecHasItem(fspec, 12)) {
            uint8_t mds[7];
            for (int i = 0; i < 7; i++) mds[i] = br.readU8(8);
        }

        br.alignToByte();

        if (tp.has_position || tp.has_mode_s) {
            result.push_back(tp);
        }

        size_t record_end = br.bytePos();
        if (record_end >= record_start && record_end - record_start < 3) break;
        if (br.bytePos() >= len - 1) break;
    }

    return result;
}

}
