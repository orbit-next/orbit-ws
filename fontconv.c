#include <stdio.h>
#include <stdlib.h>

// converts font file
// the output format uses 16 bytes for each character
// each byte is a line of that character, from top to bottom
// each bit of each byte determines whether that pixel of that line is set

#define ROW_NCHARS 64
#define COL_NCHARS 4

#define CHAR_W 8
#define CHAR_H 16

int main() {
    char *input = malloc(ROW_NCHARS * COL_NCHARS * CHAR_W * CHAR_H);
    char *output = malloc(ROW_NCHARS * COL_NCHARS * CHAR_H);
    fread(input, 1, ROW_NCHARS * COL_NCHARS * CHAR_W * CHAR_H, stdin);

    for (int cr = 0; cr < COL_NCHARS; cr++) {
        for (int cc = 0; cc < ROW_NCHARS; cc++) {
            int cn = cr * ROW_NCHARS + cc;
            for (int py = 0; py < CHAR_H; py++) {
                char row = 0;
                for (int px = 0; px < CHAR_W; px++) {
                    int inbytepos = cr * CHAR_W * CHAR_H * ROW_NCHARS +
                        cc * CHAR_W +
                        py * ROW_NCHARS * CHAR_W +
                        px;
                    if (input[inbytepos] == 0) {
                        row |= (1 << px);

                    }
                }
                int outbytepos = cn * CHAR_H + py;
                output[outbytepos] = row;
            }
        }
    }

    fwrite(output, 1, ROW_NCHARS * COL_NCHARS * CHAR_H, stdout);
}


