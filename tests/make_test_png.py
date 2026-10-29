"""Writes mcgt-e2e-test.png (200x200 gradient) for storefront_e2e.py."""
import struct
import zlib

w = h = 200


def chunk(t, d):
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)


rows = b''.join(b'\x00' + b''.join(bytes([(x * 255) // w, (y * 255) // h, 128, 255]) for x in range(w))
               for y in range(h))
png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))
open('mcgt-e2e-test.png', 'wb').write(png)
