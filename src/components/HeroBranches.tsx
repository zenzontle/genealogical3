export function HeroBranches() {
  return (
    <svg className="hero-branches" viewBox="0 0 600 540" aria-hidden="true" focusable="false">
      {['translate(0 0)', 'translate(600 8) scale(-1 1)'].map((transform) => (
        <g key={transform} transform={transform}>
          <g className="hero-branch-stems">
            <path d="M260 470C208 433 175 390 146 331S91 220 61 158" />
            <path d="M213 427C182 399 142 388 98 387M178 385C170 355 171 330 184 306M152 343C126 322 95 317 63 320M127 293C122 260 131 235 143 211M107 252C84 232 56 230 31 216M88 212C83 188 85 167 87 148" />
            <path d="M188 397C156 389 133 372 119 353M171 368C154 343 151 323 154 306M119 276C99 259 77 249 53 245M99 234C80 207 62 192 37 184" />
          </g>
          <g className="hero-branch-leaves">
            <path d="M213 427C180 430 155 420 136 408C163 401 194 405 213 427Z" />
            <path d="M201 416C181 390 181 362 198 335C208 362 212 389 201 416Z" />
            <path d="M177 385C149 379 126 362 116 342C142 346 166 360 177 385Z" />
            <path d="M170 366C165 339 174 313 191 293C192 321 186 346 170 366Z" />
            <path d="M152 343C127 346 100 335 81 320C110 315 136 323 152 343Z" />
            <path d="M143 325C135 296 142 269 161 243C162 274 156 301 143 325Z" />
            <path d="M127 293C101 289 77 275 62 255C91 258 115 270 127 293Z" />
            <path d="M124 277C115 251 120 226 134 204C141 231 136 256 124 277Z" />
            <path d="M107 252C82 253 57 241 42 224C69 225 92 234 107 252Z" />
            <path d="M88 212C74 192 74 169 82 145C94 168 96 190 88 212Z" />
          </g>
          <g className="hero-branch-veins">
            <path d="M213 427L148 410M201 416L198 351M177 385L125 352M170 366L187 308M152 343L94 324M143 325L157 260M127 293L74 263M124 277L132 222M107 252L55 230M88 212L83 159" />
          </g>
          <g className="hero-branch-berries">
            <circle cx="61" cy="158" r="7" />
            <circle cx="37" cy="184" r="6" />
            <circle cx="53" cy="245" r="5" />
            <circle cx="63" cy="320" r="7" />
            <circle cx="119" cy="353" r="5" />
            <circle cx="154" cy="306" r="6" />
            <circle cx="184" cy="306" r="7" />
          </g>
        </g>
      ))}
    </svg>
  );
}
